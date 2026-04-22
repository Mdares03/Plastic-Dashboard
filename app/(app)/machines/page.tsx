import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/requireSession";
import {
  fetchLatestHeartbeats,
  fetchMachineBase,
  mergeMachineOverviewRows,
} from "@/lib/machines/withLatest";
import MachinesClient from "./MachinesClient";

function toIso(value?: Date | null) {
  return value ? value.toISOString() : null;
}

export default async function MachinesPage() {
  const session = await requireSession();
  if (!session) redirect("/login?next=/machines");

  const machines = await fetchMachineBase(session.orgId);
  const heartbeats = await fetchLatestHeartbeats(
    session.orgId,
    machines.map((machine) => machine.id)
  );
  const rows = mergeMachineOverviewRows({
    machines,
    heartbeats,
    includeKpi: false,
  });

  const initialMachines = rows.map((machine) => ({
    id: machine.id,
    name: machine.name,
    code: machine.code ?? null,
    location: machine.location ?? null,
    latestHeartbeat: machine.latestHeartbeat
      ? {
          ts: toIso(machine.latestHeartbeat.ts) ?? "",
          tsServer: toIso(machine.latestHeartbeat.tsServer),
          status: machine.latestHeartbeat.status,
          message: machine.latestHeartbeat.message ?? null,
          ip: machine.latestHeartbeat.ip ?? null,
          fwVersion: machine.latestHeartbeat.fwVersion ?? null,
        }
      : null,
  }));

  return <MachinesClient initialMachines={initialMachines} />;
}
