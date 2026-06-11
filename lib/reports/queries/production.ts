import { prisma } from "@/lib/prisma";
import { isTemporarilyBlockedWorkOrder } from "@/lib/workOrders/temporaryBlocklist";
import { resolveWindow, windowProduction, type CycleDelta } from "@/lib/metrics";

/**
 * R2 — in-window production vs target.
 *
 * FIX: the previous implementation windowed *lifetime* MachineWorkOrder.goodParts
 * by updatedAt, so any work order merely touched in the window contributed its
 * entire life's good-parts count. In-window production is now the sum of deduped
 * MachineCycle goodDelta with ts in [from, to] (windowProduction). `target` is the
 * sum of targetQty for the work orders that actually ran cycles in the window —
 * the goal those produced parts are measured against.
 */
export async function getProductionVsTarget(params: {
  orgId: string;
  from: Date;
  to: Date;
  machineIds: string[];
}) {
  const { orgId, from, to, machineIds } = params;
  if (!machineIds.length) return { good: 0, target: 0, pct: 0 };

  const window = resolveWindow({ mode: "custom", timezone: "UTC", start: from, end: to });

  const [cycleRows, woRows] = await Promise.all([
    prisma.machineCycle.findMany({
      where: { orgId, machineId: { in: machineIds }, ts: { gte: from, lte: to } },
      select: { machineId: true, ts: true, cycleCount: true, goodDelta: true, scrapDelta: true, workOrderId: true, sku: true },
    }),
    prisma.machineWorkOrder.findMany({
      where: { orgId, machineId: { in: machineIds } },
      select: { machineId: true, workOrderId: true, sku: true, targetQty: true },
    }),
  ]);

  const isBlocked = (machineId: string, workOrderId: string | null, sku: string | null) =>
    isTemporarilyBlockedWorkOrder({ machineId, workOrderId: workOrderId ?? "", sku: sku ?? "" });

  // R2 good: deduped in-window cycle deltas, excluding blocklisted WOs.
  const cycles: CycleDelta[] = cycleRows
    .filter((c) => !isBlocked(c.machineId, c.workOrderId, c.sku))
    .map((c) => ({
      ts: c.ts,
      cycleCount: c.cycleCount,
      goodDelta: c.goodDelta,
      scrapDelta: c.scrapDelta,
      workOrderId: c.workOrderId,
    }));
  const good = windowProduction(cycles, [], window).goodParts;

  // Target: WOs that actually ran cycles in the window (keyed by machine+WO).
  const activeWoKeys = new Set(
    cycleRows
      .filter((c) => c.workOrderId)
      .map((c) => `${c.machineId}|${String(c.workOrderId).trim().toUpperCase()}`),
  );
  let target = 0;
  for (const wo of woRows) {
    if (isBlocked(wo.machineId, wo.workOrderId, wo.sku)) continue;
    const key = `${wo.machineId}|${String(wo.workOrderId).trim().toUpperCase()}`;
    if (!activeWoKeys.has(key)) continue;
    target += Math.max(0, Number(wo.targetQty ?? 0));
  }

  return {
    good,
    target,
    pct: target > 0 ? (good / target) * 100 : 0,
  };
}
