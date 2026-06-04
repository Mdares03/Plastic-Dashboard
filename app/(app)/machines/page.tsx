import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/requireSession";
import {
  fetchActiveWorkOrders,
  fetchDowntimeCountsByWorkOrder,
  fetchLatestHeartbeats,
  fetchLatestKpis,
  fetchLatestMacrostops,
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
  const machineIds = machines.map((machine) => machine.id);

  const [heartbeats, kpis, macrostops, activeWorkOrders] = await Promise.all([
    fetchLatestHeartbeats(session.orgId, machineIds),
    fetchLatestKpis(session.orgId, machineIds),
    fetchLatestMacrostops(session.orgId, machineIds),
    fetchActiveWorkOrders(session.orgId, machineIds),
  ]);

  const downtimeCountByWorkOrder = await fetchDowntimeCountsByWorkOrder(
    session.orgId,
    activeWorkOrders.map((row) => row.workOrderId)
  );

  const rows = mergeMachineOverviewRows({
    machines,
    heartbeats,
    kpis,
    macrostops,
    activeWorkOrders,
    downtimeCountByWorkOrder,
    includeKpi: true,
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
    latestKpi: machine.latestKpi
      ? {
          ts: toIso(machine.latestKpi.ts) ?? "",
          oee: machine.latestKpi.oee ?? null,
          cycleTime: machine.latestKpi.cycleTime ?? null,
        }
      : null,
    latestMacrostop: machine.latestMacrostop
      ? {
          machineId: machine.latestMacrostop.machineId,
          ts: toIso(machine.latestMacrostop.ts) ?? "",
          status: machine.latestMacrostop.status,
          startedAtMs: machine.latestMacrostop.startedAtMs,
        }
      : null,
    activeWorkOrder: machine.activeWorkOrder
      ? {
          id: machine.activeWorkOrder.id,
          workOrderId: machine.activeWorkOrder.workOrderId,
          sku: machine.activeWorkOrder.sku,
          mold: machine.activeWorkOrder.mold,
          target: machine.activeWorkOrder.target,
          goodParts: machine.activeWorkOrder.goodParts,
          scrapParts: machine.activeWorkOrder.scrapParts,
          cycleTime: machine.activeWorkOrder.cycleTime,
          stopsCount: machine.activeWorkOrder.stopsCount,
        }
      : null,
  }));

  return <MachinesClient initialMachines={initialMachines} />;
}
