import { describe, expect, it } from "vitest";
import {
  checkCounterDrift,
  dedupeCycles,
  windowProduction,
  workOrderLifetime,
} from "@/lib/metrics/production";
import { resolveWindow } from "@/lib/metrics/window";
import { at, cycle, HOUR, reason, T0, workOrder } from "../fixtures/scenario";

// A fixed 24h custom window [T0, T0+24h] for deterministic golden numbers.
const WINDOW = resolveWindow({ mode: "custom", timezone: "UTC", start: T0, end: at(24 * HOUR) });

describe("R1 — counter authority", () => {
  it("reads lifetime totals straight off the WO counters", () => {
    const wo = workOrder({ workOrderId: "WO1", goodParts: 35, scrapParts: 4, cycleCount: 3 });
    expect(workOrderLifetime(wo)).toEqual({ goodParts: 35, scrapParts: 4, cycleCount: 3 });
  });
});

describe("R2 — window production", () => {
  const cycles = [
    cycle({ ts: at(1 * HOUR), cycleCount: 1, goodDelta: 10, scrapDelta: 1, workOrderId: "WO1" }),
    cycle({ ts: at(2 * HOUR), cycleCount: 2, goodDelta: 20, scrapDelta: 2, workOrderId: "WO1" }),
    // duplicate of cycle #2 (same ts + cycleCount) — must be deduped, not double-counted
    cycle({ ts: at(2 * HOUR), cycleCount: 2, goodDelta: 20, scrapDelta: 2, workOrderId: "WO1" }),
    // before the window — must be excluded
    cycle({ ts: at(-1 * HOUR), cycleCount: 0, goodDelta: 5, scrapDelta: 0, workOrderId: "WO1" }),
  ];

  it("dedupes cycle rows on (ts, cycleCount)", () => {
    expect(dedupeCycles(cycles)).toHaveLength(3);
  });

  it("sums deduped in-window cycle deltas plus manual scrap", () => {
    const scrapReasons = [
      reason({ kind: "scrap", capturedAt: at(3 * HOUR), scrapQty: 4 }),
      // scrap outside the window — excluded
      reason({ kind: "scrap", capturedAt: at(48 * HOUR), scrapQty: 99 }),
    ];
    expect(windowProduction(cycles, scrapReasons, WINDOW)).toEqual({
      goodParts: 30, // 10 + 20 (dup ignored, pre-window ignored)
      scrapParts: 7, // 1 + 2 cycle scrap + 4 manual scrap
      cycleCount: 2,
    });
  });

  it("never windows lifetime counters by updatedAt (only cycle deltas count)", () => {
    // A WO touched once in the window must NOT contribute its lifetime total.
    const result = windowProduction(cycles, [], WINDOW);
    expect(result.goodParts).toBe(30);
    expect(result.goodParts).not.toBe(35); // 35 = the lifetime counter (the old bug)
  });
});

describe("R3 — reconciliation invariant", () => {
  it("surfaces drift between counters and cycle-delta sums (never hides it)", () => {
    const wo = workOrder({ workOrderId: "WO1", goodParts: 35, scrapParts: 4, cycleCount: 3 });
    const lifetimeCycles = [
      cycle({ ts: at(1 * HOUR), cycleCount: 1, goodDelta: 10, scrapDelta: 1 }),
      cycle({ ts: at(2 * HOUR), cycleCount: 2, goodDelta: 20, scrapDelta: 2 }),
      cycle({ ts: at(2 * HOUR), cycleCount: 2, goodDelta: 20, scrapDelta: 2 }), // dup
      cycle({ ts: at(-1 * HOUR), cycleCount: 0, goodDelta: 5, scrapDelta: 0 }),
    ];
    const drift = checkCounterDrift(wo, lifetimeCycles);
    expect(drift.goodDrift).toBe(0); // 35 counter vs 35 deltas
    expect(drift.scrapDrift).toBe(1); // 4 counter vs 3 deltas → surfaced
    expect(drift.cycleDrift).toBe(0); // 3 counter vs 3 deduped rows
    expect(drift.hasDrift).toBe(true);
  });

  it("reports zero drift when counters reconcile exactly", () => {
    const wo = workOrder({ workOrderId: "WO2", goodParts: 10, scrapParts: 1, cycleCount: 1 });
    const drift = checkCounterDrift(wo, [
      cycle({ ts: at(1 * HOUR), cycleCount: 1, goodDelta: 10, scrapDelta: 1 }),
    ]);
    expect(drift.hasDrift).toBe(false);
  });
});
