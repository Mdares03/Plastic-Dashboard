/**
 * R1 (counter authority) + R2 (window production) + R3 (reconciliation).
 *
 * R1: lifetime totals for a work order are the edge-maintained MachineWorkOrder
 *     counters (good_parts/scrap_parts/cycle_count) — never windowed, never
 *     recomputed from snapshots. These match the Pi's home UI.
 * R2: in-window production is the sum of *deduplicated* MachineCycle deltas with
 *     ts in [start, end], plus manual-scrap ReasonEntry rows captured in window.
 *     This replaces lib/reports/queries/production.ts windowing lifetime counters
 *     by updatedAt (the bug that made one touched WO contribute its whole life).
 * R3: for a completed WO, counters (R1) must equal the sum of its cycle deltas
 *     (R2). Drift is reported, never silently resolved (no more max()).
 */
import type {
  CounterDrift,
  CycleDelta,
  ReasonRow,
  ResolvedWindow,
  WindowProduction,
  WorkOrderCounters,
} from "./types";

const trunc0 = (v: number | null | undefined) => Math.max(0, Math.trunc(v ?? 0));

/** R2 — dedup cycle rows on the (ts, cycleCount) natural key (per machine). */
export function dedupeCycles(cycles: CycleDelta[]): CycleDelta[] {
  const seen = new Set<string>();
  const out: CycleDelta[] = [];
  for (const c of cycles) {
    const key = `${c.ts.getTime()}:${c.cycleCount ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

/** R1 — lifetime totals straight off the WO counters. */
export function workOrderLifetime(wo: WorkOrderCounters): WindowProduction {
  return {
    goodParts: trunc0(wo.goodParts),
    scrapParts: trunc0(wo.scrapParts),
    cycleCount: trunc0(wo.cycleCount),
  };
}

/**
 * R2 — production inside [window.start, window.end] from deduped cycle deltas
 * plus manual scrap (ReasonEntry kind `scrap`) captured in the window.
 */
export function windowProduction(
  cycles: CycleDelta[],
  scrapReasons: ReasonRow[],
  window: ResolvedWindow,
): WindowProduction {
  const startMs = window.start.getTime();
  const endMs = window.end.getTime();
  let goodParts = 0;
  let scrapParts = 0;
  let cycleCount = 0;

  for (const c of dedupeCycles(cycles)) {
    const t = c.ts.getTime();
    if (t < startMs || t > endMs) continue;
    cycleCount += 1;
    goodParts += trunc0(c.goodDelta);
    scrapParts += trunc0(c.scrapDelta);
  }

  for (const r of scrapReasons) {
    if (String(r.kind).toLowerCase() !== "scrap") continue;
    const t = r.capturedAt.getTime();
    if (t < startMs || t > endMs) continue;
    scrapParts += trunc0(r.scrapQty);
  }

  return { goodParts, scrapParts, cycleCount };
}

/**
 * R3 — drift between a WO's counters (R1) and the sum of its cycle deltas (R2)
 * over the WO's lifetime. `cyclesForWo` must already be filtered to this WO.
 * Drift is surfaced (health endpoint, verification reports), never auto-fixed.
 */
export function checkCounterDrift(
  wo: WorkOrderCounters,
  cyclesForWo: CycleDelta[],
): CounterDrift {
  let cycleGood = 0;
  let cycleScrap = 0;
  let cycleRows = 0;
  for (const c of dedupeCycles(cyclesForWo)) {
    cycleRows += 1;
    cycleGood += trunc0(c.goodDelta);
    cycleScrap += trunc0(c.scrapDelta);
  }
  const counterGood = trunc0(wo.goodParts);
  const counterScrap = trunc0(wo.scrapParts);
  const counterCycles = trunc0(wo.cycleCount);
  const goodDrift = counterGood - cycleGood;
  const scrapDrift = counterScrap - cycleScrap;
  const cycleDrift = counterCycles - cycleRows;
  return {
    workOrderId: wo.workOrderId,
    counterGood,
    cycleGood,
    goodDrift,
    counterScrap,
    cycleScrap,
    scrapDrift,
    counterCycles,
    cycleRows,
    cycleDrift,
    hasDrift: goodDrift !== 0 || scrapDrift !== 0 || cycleDrift !== 0,
  };
}
