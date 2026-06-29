import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/requireSession";
import { getAlertsInboxData, getAlertThrottleStats } from "@/lib/alerts/getAlertsInboxData";
import AlertsClient from "./AlertsClient";

export default async function AlertsPage() {
  const session = await requireSession();
  if (!session) redirect("/login?next=/alerts");

  const [machines, shiftRows, inbox, throttleStats, membership] = await Promise.all([
    prisma.machine.findMany({
      where: { orgId: session.orgId },
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, location: true },
    }),
    prisma.orgShift.findMany({
      where: { orgId: session.orgId },
      orderBy: { sortOrder: "asc" },
      select: { name: true, enabled: true },
    }),
    getAlertsInboxData({
      orgId: session.orgId,
      range: "24h",
      limit: 250,
    }),
    getAlertThrottleStats(session.orgId),
    prisma.orgUser.findUnique({
      where: { orgId_userId: { orgId: session.orgId, userId: session.userId } },
      select: { role: true },
    }),
  ]);
  const canSendTest = membership?.role === "OWNER" || membership?.role === "ADMIN";

  const initialEvents = inbox.events.map((event) => ({
    ...event,
    ts: event.ts ? event.ts.toISOString() : "",
  }));

  const initialShifts = shiftRows.map((shift) => ({
    name: shift.name,
    enabled: shift.enabled !== false,
  }));

  return (
    <AlertsClient
      initialMachines={machines}
      initialShifts={initialShifts}
      initialEvents={initialEvents}
      throttleStats={throttleStats}
      canSendTest={canSendTest}
    />
  );
}
