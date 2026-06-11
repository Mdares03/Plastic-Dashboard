import { prisma } from "@/lib/prisma";
import { dedupeCycles } from "@/lib/metrics";
import type { MachineCostProfile, ScrapRow } from "@/lib/reports/types";

type SkuAgg = {
  sku: string;
  scrapUnits: number;
  totalUnits: number;
  estimatedCostMXN: number;
  reasonCounts: Map<string, number>;
};

export async function getScrapTopSkus(params: {
  orgId: string;
  from: Date;
  to: Date;
  machineIds: string[];
  machineCostProfileById: Map<string, MachineCostProfile>;
}) {
  const { orgId, from, to, machineIds, machineCostProfileById } = params;
  if (!machineIds.length) return [] as ScrapRow[];

  const [scrapRows, cycleRows, workOrders] = await Promise.all([
    prisma.reasonEntry.findMany({
      where: {
        orgId,
        machineId: { in: machineIds },
        kind: "scrap",
        capturedAt: { gte: from, lte: to },
      },
      select: {
        machineId: true,
        workOrderId: true,
        scrapQty: true,
        reasonLabel: true,
      },
    }),
    prisma.machineCycle.findMany({
      where: {
        orgId,
        machineId: { in: machineIds },
        ts: { gte: from, lte: to },
      },
      select: {
        machineId: true,
        workOrderId: true,
        sku: true,
        ts: true,
        cycleCount: true,
        goodDelta: true,
        scrapDelta: true,
      },
    }),
    prisma.machineWorkOrder.findMany({
      where: {
        orgId,
        machineId: { in: machineIds },
      },
      select: {
        machineId: true,
        workOrderId: true,
        sku: true,
      },
      orderBy: { updatedAt: "desc" },
    }),
  ]);

  if (!scrapRows.length) return [];

  const skuByWorkOrder = new Map<string, string>();
  for (const row of workOrders) {
    const key = `${row.machineId}::${row.workOrderId}`;
    if (!skuByWorkOrder.has(key) && row.sku) {
      skuByWorkOrder.set(key, row.sku);
    }
  }

  for (const cycle of cycleRows) {
    const key = `${cycle.machineId}::${cycle.workOrderId ?? ""}`;
    if (cycle.workOrderId && cycle.sku && !skuByWorkOrder.has(key)) {
      skuByWorkOrder.set(key, cycle.sku);
    }
  }

  // R2: dedupe cycle deltas per machine before summing the scrap-% denominator,
  // so totalUnits matches the production report's good+scrap counts.
  const cyclesByMachine = new Map<string, typeof cycleRows>();
  for (const cycle of cycleRows) {
    const list = cyclesByMachine.get(cycle.machineId) ?? [];
    list.push(cycle);
    cyclesByMachine.set(cycle.machineId, list);
  }
  const totalUnitsBySku = new Map<string, number>();
  for (const list of cyclesByMachine.values()) {
    for (const cycle of dedupeCycles(list)) {
      const sku = cycle.sku ?? (cycle.workOrderId ? skuByWorkOrder.get(`${cycle.machineId}::${cycle.workOrderId}`) : null);
      if (!sku) continue;
      const units = Math.max(0, Number(cycle.goodDelta ?? 0)) + Math.max(0, Number(cycle.scrapDelta ?? 0));
      totalUnitsBySku.set(sku, (totalUnitsBySku.get(sku) ?? 0) + units);
    }
  }

  const skuAgg = new Map<string, SkuAgg>();

  for (const row of scrapRows) {
    const sku = row.workOrderId ? skuByWorkOrder.get(`${row.machineId}::${row.workOrderId}`) : null;
    if (!sku) continue;

    const scrapUnits = Math.max(0, Number(row.scrapQty ?? 0));
    const scrapCostPerUnit = machineCostProfileById.get(row.machineId)?.scrapCostPerUnit ?? null;
    const cost = scrapCostPerUnit == null ? 0 : scrapUnits * scrapCostPerUnit;

    const agg =
      skuAgg.get(sku) ??
      ({
        sku,
        scrapUnits: 0,
        totalUnits: totalUnitsBySku.get(sku) ?? 0,
        estimatedCostMXN: 0,
        reasonCounts: new Map<string, number>(),
      } as SkuAgg);

    agg.scrapUnits += scrapUnits;
    agg.estimatedCostMXN += cost;
    const label = row.reasonLabel || "Sin razón";
    agg.reasonCounts.set(label, (agg.reasonCounts.get(label) ?? 0) + scrapUnits);

    skuAgg.set(sku, agg);
  }

  return [...skuAgg.values()]
    .sort((a, b) => b.scrapUnits - a.scrapUnits)
    .slice(0, 3)
    .map((row) => {
      const topReason = [...row.reasonCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "Sin razón";
      const totalUnits = row.totalUnits;
      const scrapPct = totalUnits > 0 ? (row.scrapUnits / totalUnits) * 100 : 0;
      return {
        sku: row.sku,
        scrapUnits: row.scrapUnits,
        totalUnits,
        scrapPct,
        topReasonLabel: topReason,
        estimatedCostMXN: row.estimatedCostMXN,
      };
    });
}
