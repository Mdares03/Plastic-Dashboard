import { prisma } from "@/lib/prisma";
import type { CyclePerfRow, MachineCostProfile } from "@/lib/reports/types";
import { isTemporarilyBlockedWorkOrder } from "@/lib/workOrders/temporaryBlocklist";

type CycleKey = `${string}::${string}`;

type CycleResult = {
  rows: CyclePerfRow[];
  totalPerformanceLossMXN: number;
};

function key(machineId: string, workOrderId: string): CycleKey {
  return `${machineId}::${workOrderId}`;
}

export async function getCyclePerformanceByWorkOrder(params: {
  orgId: string;
  from: Date;
  to: Date;
  machineIds: string[];
  machineNameById: Map<string, string>;
  machineCostProfileById: Map<string, MachineCostProfile>;
}): Promise<CycleResult> {
  const { orgId, from, to, machineIds, machineNameById, machineCostProfileById } = params;

  if (!machineIds.length) return { rows: [], totalPerformanceLossMXN: 0 };

  const cycles = await prisma.machineCycle.findMany({
    where: {
      orgId,
      machineId: { in: machineIds },
      ts: { gte: from, lte: to },
      workOrderId: { not: null },
    },
    select: {
      machineId: true,
      workOrderId: true,
      sku: true,
      actualCycleTime: true,
      goodDelta: true,
      scrapDelta: true,
    },
  });

  if (!cycles.length) return { rows: [], totalPerformanceLossMXN: 0 };

  const filteredCycles = cycles.filter(
    (cycle) =>
      cycle.workOrderId &&
      !isTemporarilyBlockedWorkOrder({
        machineId: cycle.machineId,
        workOrderId: cycle.workOrderId,
        sku: cycle.sku,
      })
  );

  if (!filteredCycles.length) return { rows: [], totalPerformanceLossMXN: 0 };

  const workOrderIds = Array.from(
    new Set(filteredCycles.map((c) => c.workOrderId).filter((value): value is string => !!value))
  );

  const workOrders = await prisma.machineWorkOrder.findMany({
    where: {
      orgId,
      machineId: { in: machineIds },
      workOrderId: { in: workOrderIds },
    },
    orderBy: { updatedAt: "desc" },
    select: {
      machineId: true,
      workOrderId: true,
      sku: true,
      cycleTime: true,
    },
  });

  const woByKey = new Map<CycleKey, { sku: string | null; cycleTime: number | null }>();
  for (const wo of workOrders) {
    if (
      isTemporarilyBlockedWorkOrder({
        machineId: wo.machineId,
        workOrderId: wo.workOrderId,
        sku: wo.sku,
      })
    ) {
      continue;
    }

    const k = key(wo.machineId, wo.workOrderId);
    if (!woByKey.has(k)) {
      woByKey.set(k, {
        sku: wo.sku ?? null,
        cycleTime: wo.cycleTime ?? null,
      });
    }
  }

  const agg = new Map<
    CycleKey,
    {
      machineId: string;
      workOrderId: string;
      sku: string;
      actualSum: number;
      actualCount: number;
      unitsProduced: number;
    }
  >();

  for (const cycle of filteredCycles) {
    if (!cycle.workOrderId) continue;
    const k = key(cycle.machineId, cycle.workOrderId);
    const prev =
      agg.get(k) ??
      ({
        machineId: cycle.machineId,
        workOrderId: cycle.workOrderId,
        sku: cycle.sku ?? "--",
        actualSum: 0,
        actualCount: 0,
        unitsProduced: 0,
      });

    if (Number.isFinite(cycle.actualCycleTime)) {
      prev.actualSum += Number(cycle.actualCycleTime);
      prev.actualCount += 1;
    }
    const produced = Math.max(0, Number(cycle.goodDelta ?? 0)) + Math.max(0, Number(cycle.scrapDelta ?? 0));
    prev.unitsProduced += produced;

    agg.set(k, {
      ...prev,
      sku: cycle.sku ?? prev.sku,
    });
  }

  let totalPerformanceLossMXN = 0;

  const rows: CyclePerfRow[] = [...agg.entries()]
    .map(([k, value]) => {
      const wo = woByKey.get(k);
      const targetCycleSec = Math.max(0, Number(wo?.cycleTime ?? 0));
      const actualAvgCycleSec = value.actualCount > 0 ? value.actualSum / value.actualCount : 0;
      const deltaPct =
        targetCycleSec > 0
          ? ((actualAvgCycleSec - targetCycleSec) / targetCycleSec) * 100
          : 0;

      if (targetCycleSec > 0 && value.unitsProduced > 0 && actualAvgCycleSec > targetCycleSec) {
        const extraSeconds = (actualAvgCycleSec - targetCycleSec) * value.unitsProduced;
        const machineCostPerMin =
          machineCostProfileById.get(value.machineId)?.machineCostPerMin ?? null;
        if (machineCostPerMin != null) {
          totalPerformanceLossMXN += (extraSeconds / 60) * machineCostPerMin;
        }
      }

      return {
        workOrderId: value.workOrderId,
        sku: wo?.sku ?? value.sku,
        machineName: machineNameById.get(value.machineId) ?? value.machineId,
        targetCycleSec,
        actualAvgCycleSec,
        deltaPct,
        unitsProduced: value.unitsProduced,
      };
    })
    .filter((row) => row.workOrderId)
    .sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct));

  return {
    rows,
    totalPerformanceLossMXN,
  };
}
