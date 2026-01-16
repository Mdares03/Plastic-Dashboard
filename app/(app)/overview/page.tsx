import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/requireSession";
import { getOverviewData } from "@/lib/overview/getOverviewData";
import OverviewClient from "./OverviewClient";

function toIso(value?: Date | null) {
  return value ? value.toISOString() : null;
}

export default async function OverviewPage() {
  const session = await requireSession();
  if (!session) redirect("/login?next=/overview");

  const { machines, events } = await getOverviewData({
    orgId: session.orgId,
    eventsMode: "critical",
    eventsWindowSec: 21600,
    eventMachines: 6,
  });

  const initialMachines = machines.map((machine) => ({
    ...machine,
    createdAt: toIso(machine.createdAt),
    updatedAt: toIso(machine.updatedAt),
    latestHeartbeat: machine.latestHeartbeat
      ? {
          ...machine.latestHeartbeat,
          ts: toIso(machine.latestHeartbeat.ts) ?? "",
          tsServer: toIso(machine.latestHeartbeat.tsServer),
        }
      : null,
    latestKpi: machine.latestKpi
      ? {
          ...machine.latestKpi,
          ts: toIso(machine.latestKpi.ts) ?? "",
        }
      : null,
  }));

  const initialEvents = events.map((event) => ({
    ...event,
    ts: event.ts ? event.ts.toISOString() : "",
    machineName: event.machineName ?? undefined,
  }));

  return <OverviewClient initialMachines={initialMachines} initialEvents={initialEvents} />;
}
