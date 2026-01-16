import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/requireSession";
import { getAlertsInboxData } from "@/lib/alerts/getAlertsInboxData";
import AlertsClient from "./AlertsClient";

export default async function AlertsPage() {
  const session = await requireSession();
  if (!session) redirect("/login?next=/alerts");

  const [machines, shiftRows, inbox] = await Promise.all([
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
  ]);

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
    />
  );
}
