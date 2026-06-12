import { describe, expect, it } from "vitest";
import {
  computeDowntime,
  episodeWindowMinutes,
  windowProduction,
  checkCounterDrift,
  resolveWindow,
  DEFAULT_PLANNED_CODES,
} from "@/lib/metrics";
import { classifyDowntimeCategory } from "@/lib/financial/impact";
import { at, cycle, HOUR, reason, T0, workOrder } from "../fixtures/scenario";

/**
 * Cross-module congruence suite — the postmortem's "every screen shows the same
 * number" guarantee, locked in CI. One seeded scenario, asserting the invariants
 * that tie the separate aggregation paths (downtime / financial / production)
 * together. If any view drifts from the authority, one of these breaks.
 */
const WINDOW = resolveWindow({ mode: "custom", timezone: "UTC", start: T0, end: at(24 * HOUR) });

const downtimeRows = [
  reason({ reasonCode: "UNPLANNED_A", durationSeconds: 45 * 60, episodeEndTs: at(2 * HOUR), capturedAt: at(2 * HOUR) }),
  reason({ reasonCode: "UNPLANNED_B", durationSeconds: 90, episodeEndTs: at(3 * HOUR), capturedAt: at(3 * HOUR) }), // micro (<120s)
  reason({ reasonCode: "MOLD_CHANGE", durationSeconds: 30 * 60, episodeEndTs: at(5 * HOUR), capturedAt: at(5 * HOUR) }), // planned
  reason({ reasonCode: "UNPLANNED_C", durationSeconds: 20 * 60, episodeEndTs: at(8 * HOUR), capturedAt: at(8 * HOUR) }),
];

describe("R5 — downtime aggregate matches its own breakdown", () => {
  const dt = computeDowntime(downtimeRows, WINDOW);

  it("totalMin equals the sum of the per-reason buckets", () => {
    const byReasonSum = dt.byReason.reduce((acc, b) => acc + b.minutes, 0);
    expect(Math.round(byReasonSum * 100) / 100).toBe(dt.totalMin);
  });

  it("unplanned == total − planned (no third source)", () => {
    expect(dt.unplannedMin).toBe(Math.round((dt.totalMin - dt.plannedMin) * 100) / 100);
    expect(dt.plannedMin).toBe(30); // MOLD_CHANGE only
  });
});

describe("#13 — financial downtime minutes are congruent with the dashboard (R5)", () => {
  const dt = computeDowntime(downtimeRows, WINDOW);

  // What lib/financial/impact charges: episodeWindowMinutes over non-planned rows.
  const financialEpisodes = downtimeRows
    .filter((r) => String(r.kind).toLowerCase() === "downtime")
    .filter((r) => !DEFAULT_PLANNED_CODES.has(String(r.reasonCode).toUpperCase()))
    .map((r) => ({ row: r, minutes: episodeWindowMinutes(r, WINDOW.start, WINDOW.end) }));
  const financialMinutes = financialEpisodes.reduce((acc, e) => acc + e.minutes, 0);

  it("financial cost-minutes == computeDowntime.unplannedMin (Δ=0, the prod exhibit as a unit test)", () => {
    expect(Math.round(financialMinutes * 100) / 100).toBe(dt.unplannedMin);
  });

  it("micro/macro split partitions the unplanned minutes (nothing lost or double-counted)", () => {
    let micro = 0;
    let macro = 0;
    for (const e of financialEpisodes) {
      if (classifyDowntimeCategory(e.row.durationSeconds) === "microstop") micro += e.minutes;
      else macro += e.minutes;
    }
    expect(Math.round((micro + macro) * 100) / 100).toBe(dt.unplannedMin);
    expect(micro).toBeCloseTo(1.5, 5); // UNPLANNED_B: 90s = 1.5 min
  });
});

describe("R1/R2/R3 — counters reconcile with cycle deltas", () => {
  const cycles = [
    cycle({ ts: at(1 * HOUR), goodDelta: 100, scrapDelta: 2, cycleCount: 1, workOrderId: "WO1" }),
    cycle({ ts: at(2 * HOUR), goodDelta: 150, scrapDelta: 3, cycleCount: 2, workOrderId: "WO1" }),
    cycle({ ts: at(6 * HOUR), goodDelta: 50, scrapDelta: 0, cycleCount: 3, workOrderId: "WO1" }),
  ];

  it("windowProduction (R2) equals the WO counters (R1) when there is no drift (R3)", () => {
    const prod = windowProduction(cycles, [], WINDOW);
    const wo = workOrder({ workOrderId: "WO1", goodParts: 300, scrapParts: 5, cycleCount: 3 });
    const drift = checkCounterDrift(wo, cycles);
    expect(prod.goodParts).toBe(300);
    expect(prod.goodParts).toBe(drift.cycleGood);
    expect(drift.hasDrift).toBe(false);
  });

  it("R2 dedup — a duplicate cycle row does not double-count", () => {
    const withDup = [...cycles, cycles[1]]; // same (ts, cycleCount) → deduped
    expect(windowProduction(withDup, [], WINDOW).goodParts).toBe(
      windowProduction(cycles, [], WINDOW).goodParts,
    );
  });
});
