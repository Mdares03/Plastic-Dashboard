import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/requireSession";
import { getOverviewSummary } from "@/lib/overview/getOverviewSummary";
import type { getOverviewData } from "@/lib/overview/getOverviewData";
import { logLine } from "@/lib/logger";
import OverviewClient from "./OverviewClient";

function toIso(value?: Date | null) {
  return value ? value.toISOString() : null;
}

export default async function OverviewPage() {
  const session = await requireSession();
  if (!session) redirect("/login?next=/overview");

  let machines: Awaited<ReturnType<typeof getOverviewData>>["machines"];
  let events: Awaited<ReturnType<typeof getOverviewData>>["events"] = [];
  try {
    const data = await getOverviewSummary({ orgId: session.orgId });
    machines = data.machines;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    logLine("OverviewPage.getOverviewSummary.error", { message, stack });
    console.error("[OverviewPage] getOverviewSummary:", err);
    machines = [];
  }

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
