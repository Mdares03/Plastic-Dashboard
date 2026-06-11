import { describe, expect, it } from "vitest";
import { computeDowntime } from "@/lib/metrics/downtime";
import { resolveWindow } from "@/lib/metrics/window";
import { at, HOUR, MIN, reason, T0 } from "../fixtures/scenario";

const WINDOW = resolveWindow({ mode: "custom", timezone: "UTC", start: T0, end: at(24 * HOUR) });

describe("R5 — downtime authority", () => {
  const reasons = [
    // fully in-window unplanned, 10 min
    reason({ reasonCode: "UNPLANNED_X", durationSeconds: 10 * 60, episodeEndTs: at(2 * HOUR), capturedAt: at(2 * HOUR) }),
    // planned mold change, 30 min
    reason({ reasonCode: "MOLD_CHANGE", durationSeconds: 30 * 60, episodeEndTs: at(4 * HOUR), capturedAt: at(4 * HOUR) }),
    // runaway open episode: 27.7h raw → capped to 12h, ending at window end
    reason({ reasonCode: "UNPLANNED_Y", durationSeconds: 100000, episodeEndTs: at(24 * HOUR), capturedAt: at(24 * HOUR) }),
    // crosses the window start: 2h episode ending 1h in → only 1h overlaps
    reason({ reasonCode: "UNPLANNED_Z", durationSeconds: 2 * HOUR / 1000, episodeEndTs: at(1 * HOUR), capturedAt: at(1 * HOUR) }),
    // a scrap row — must be ignored by downtime
    reason({ kind: "scrap", reasonCode: "SCRAP", scrapQty: 5, capturedAt: at(3 * HOUR) }),
  ];

  const summary = computeDowntime(reasons, WINDOW);

  it("sums only ReasonEntry downtime, clamped to window overlap and capped at 12h", () => {
    // 10 (X) + 30 (MOLD) + 720 (Y, capped) + 60 (Z, clamped) = 820
    expect(summary.totalMin).toBe(820);
  });

  it("splits planned vs unplanned by reasonCode", () => {
    expect(summary.plannedMin).toBe(30); // MOLD_CHANGE only
    expect(summary.unplannedMin).toBe(790); // 820 - 30
  });

  it("ranks reasons by minutes, scrap excluded", () => {
    expect(summary.byReason.map((b) => b.reasonCode)).toEqual([
      "UNPLANNED_Y", // 720
      "UNPLANNED_Z", // 60
      "MOLD_CHANGE", // 30
      "UNPLANNED_X", // 10
    ]);
    expect(summary.byReason.find((b) => b.reasonCode === "SCRAP")).toBeUndefined();
  });

  it("ignores MachineEvent stop sums entirely (no max() double-authority)", () => {
    // Same reasons, but imagine events claimed far more downtime. computeDowntime
    // takes no events at all, so the reason total is the single authority.
    expect(computeDowntime(reasons, WINDOW).totalMin).toBe(820);
  });
});

describe("R5 — open episode cap edge", () => {
  it("clamps an episode entirely before the window to zero", () => {
    const before = [
      reason({ reasonCode: "OLD", durationSeconds: 5 * 60, episodeEndTs: at(-1 * HOUR), capturedAt: at(-1 * HOUR) }),
    ];
    expect(computeDowntime(before, WINDOW).totalMin).toBe(0);
  });
});
