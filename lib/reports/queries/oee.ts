import { prisma } from "@/lib/prisma";
import { computeWindowRates, type KpiSample } from "@/lib/metrics";
import type { MachineSnapshot } from "@/lib/reports/types";

function clampPct(value: number | null) {
  if (value == null) return 0; // R7-null is a UI-layer follow-up; shape stays numeric here
  return Math.max(0, Math.min(100, value));
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
        ts: true,
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

  // R4 — time-weighted average of production snapshots (the recap authority),
  // NOT the plain sum/count that used to make Reports disagree with Recap. Each
  // machine's window OEE is now computed exactly as recap computes it.
  const samplesByMachine = new Map<string, KpiSample[]>();
  for (const machineId of machineIds) samplesByMachine.set(machineId, []);
  const allSamples: KpiSample[] = [];
  for (const row of kpiRows) {
    const sample: KpiSample = {
      ts: row.ts,
      oee: row.oee,
      availability: row.availability,
      performance: row.performance,
      quality: row.quality,
      trackingEnabled: row.trackingEnabled,
      productionStarted: row.productionStarted,
    };
    samplesByMachine.get(row.machineId)?.push(sample);
    allSamples.push(sample);
  }
  const ratesByMachine = new Map<string, ReturnType<typeof computeWindowRates>>();
  for (const machineId of machineIds) {
    ratesByMachine.set(machineId, computeWindowRates(samplesByMachine.get(machineId) ?? [], to));
  }
  // Org roll-up uses the same R4 method over the pooled production samples.
  const totalRates = computeWindowRates(allSamples, to);

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
    const rates = ratesByMachine.get(machineId);
    const topLoss = topLossByMachine.get(machineId);
    return {
      machineId,
      name: machineNameById.get(machineId) ?? machineId,
      oee: clampPct(rates?.oee ?? null),
      availability: clampPct(rates?.availability ?? null),
      performance: clampPct(rates?.performance ?? null),
      quality: clampPct(rates?.quality ?? null),
      unitsProduced: producedByMachine.get(machineId) ?? 0,
      unitsTarget: targetByMachine.get(machineId) ?? 0,
      topLossReasonLabel: topLoss?.label ?? "Sin pérdida relevante",
      topLossMinutes: topLoss?.minutes ?? 0,
    };
  });

  return {
    oeeAvg: clampPct(totalRates.oee),
    availabilityAvg: clampPct(totalRates.availability),
    performanceAvg: clampPct(totalRates.performance),
    qualityAvg: clampPct(totalRates.quality),
    machines,
  };
}
