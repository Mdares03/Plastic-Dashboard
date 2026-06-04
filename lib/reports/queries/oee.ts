import { prisma } from "@/lib/prisma";
import type { MachineSnapshot } from "@/lib/reports/types";

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function clampPct(value: number) {
  return Math.max(0, Math.min(100, value));
}

type AvgAccumulator = {
  oeeSum: number;
  oeeCount: number;
  aSum: number;
  aCount: number;
  pSum: number;
  pCount: number;
  qSum: number;
  qCount: number;
};

function emptyAccumulator(): AvgAccumulator {
  return {
    oeeSum: 0,
    oeeCount: 0,
    aSum: 0,
    aCount: 0,
    pSum: 0,
    pCount: 0,
    qSum: 0,
    qCount: 0,
  };
}

export async function getOeeSnapshot(params: {
  orgId: string;
  from: Date;
  to: Date;
  machineIds: string[];
  machineNameById: Map<string, string>;
}) {
  const { orgId, from, to, machineIds, machineNameById } = params;

  if (!machineIds.length) {
    return {
      oeeAvg: 0,
      availabilityAvg: 0,
      performanceAvg: 0,
      qualityAvg: 0,
      machines: [] as MachineSnapshot[],
    };
  }

  const [kpiRows, cycleRows, workOrders, reasonRows] = await Promise.all([
    prisma.machineKpiSnapshot.findMany({
      where: {
        orgId,
        machineId: { in: machineIds },
        ts: { gte: from, lte: to },
      },
      select: {
        machineId: true,
        oee: true,
        availability: true,
        performance: true,
        quality: true,
        trackingEnabled: true,
        productionStarted: true,
      },
    }),
    prisma.machineCycle.findMany({
      where: {
        orgId,
        machineId: { in: machineIds },
        ts: { gte: from, lte: to },
      },
      select: { machineId: true, goodDelta: true },
    }),
    prisma.machineWorkOrder.findMany({
      where: {
        orgId,
        machineId: { in: machineIds },
        updatedAt: { gte: from, lte: to },
      },
      select: { machineId: true, targetQty: true },
    }),
    prisma.reasonEntry.findMany({
      where: {
        orgId,
        machineId: { in: machineIds },
        kind: "downtime",
        capturedAt: { gte: from, lte: to },
      },
      select: {
        machineId: true,
        reasonCode: true,
        reasonLabel: true,
        durationSeconds: true,
      },
    }),
  ]);

  const byMachine = new Map<string, AvgAccumulator>();
  for (const machineId of machineIds) {
    byMachine.set(machineId, emptyAccumulator());
  }

  const total = emptyAccumulator();

  for (const row of kpiRows) {
    if (row.trackingEnabled !== true || row.productionStarted !== true) continue;

    const metrics = [row.oee, row.availability, row.performance, row.quality];
    const allZeroOrNull = metrics.every((value) => !isFiniteNumber(value) || value === 0);
    if (allZeroOrNull) continue;

    const acc = byMachine.get(row.machineId);
    if (!acc) continue;

    if (isFiniteNumber(row.oee)) {
      acc.oeeSum += row.oee;
      acc.oeeCount += 1;
      total.oeeSum += row.oee;
      total.oeeCount += 1;
    }
    if (isFiniteNumber(row.availability)) {
      acc.aSum += row.availability;
      acc.aCount += 1;
      total.aSum += row.availability;
      total.aCount += 1;
    }
    if (isFiniteNumber(row.performance)) {
      acc.pSum += row.performance;
      acc.pCount += 1;
      total.pSum += row.performance;
      total.pCount += 1;
    }
    if (isFiniteNumber(row.quality)) {
      acc.qSum += row.quality;
      acc.qCount += 1;
      total.qSum += row.quality;
      total.qCount += 1;
    }
  }

  const producedByMachine = new Map<string, number>();
  for (const row of cycleRows) {
    const current = producedByMachine.get(row.machineId) ?? 0;
    producedByMachine.set(row.machineId, current + Math.max(0, Number(row.goodDelta ?? 0)));
  }

  const targetByMachine = new Map<string, number>();
  for (const row of workOrders) {
    const current = targetByMachine.get(row.machineId) ?? 0;
    targetByMachine.set(row.machineId, current + Math.max(0, Number(row.targetQty ?? 0)));
  }

  const topLossByMachine = new Map<string, { label: string; minutes: number }>();
  const lossAgg = new Map<string, { label: string; minutes: number }>();

  for (const row of reasonRows) {
    const durationMin = Math.max(0, Number(row.durationSeconds ?? 0)) / 60;
    const key = `${row.machineId}::${row.reasonCode}`;
    const label = String(row.reasonLabel || row.reasonCode || "Sin clasificar");
    const prev = lossAgg.get(key) ?? { label, minutes: 0 };
    prev.minutes += durationMin;
    lossAgg.set(key, prev);
  }

  for (const [key, entry] of lossAgg.entries()) {
    const [machineId] = key.split("::");
    const existing = topLossByMachine.get(machineId);
    if (!existing || entry.minutes > existing.minutes) {
      topLossByMachine.set(machineId, entry);
    }
  }

  const machines: MachineSnapshot[] = machineIds.map((machineId) => {
    const acc = byMachine.get(machineId) ?? emptyAccumulator();
    const topLoss = topLossByMachine.get(machineId);
    return {
      machineId,
      name: machineNameById.get(machineId) ?? machineId,
      oee: acc.oeeCount > 0 ? clampPct(acc.oeeSum / acc.oeeCount) : 0,
      availability: acc.aCount > 0 ? clampPct(acc.aSum / acc.aCount) : 0,
      performance: acc.pCount > 0 ? clampPct(acc.pSum / acc.pCount) : 0,
      quality: acc.qCount > 0 ? clampPct(acc.qSum / acc.qCount) : 0,
      unitsProduced: producedByMachine.get(machineId) ?? 0,
      unitsTarget: targetByMachine.get(machineId) ?? 0,
      topLossReasonLabel: topLoss?.label ?? "Sin pérdida relevante",
      topLossMinutes: topLoss?.minutes ?? 0,
    };
  });

  return {
    oeeAvg: total.oeeCount > 0 ? clampPct(total.oeeSum / total.oeeCount) : 0,
    availabilityAvg: total.aCount > 0 ? clampPct(total.aSum / total.aCount) : 0,
    performanceAvg: total.pCount > 0 ? clampPct(total.pSum / total.pCount) : 0,
    qualityAvg: total.qCount > 0 ? clampPct(total.qSum / total.qCount) : 0,
    machines,
  };
}
