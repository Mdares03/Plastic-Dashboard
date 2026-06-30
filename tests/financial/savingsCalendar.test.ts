import { describe, expect, it } from "vitest";
import { rollUpDaysToMonths } from "@/lib/financial/savingsCalendar";

// Item 2: the savings calendar rolls the financial authority's per-day cost series
// up into months with a running cumulative. The monthly totals + cumulative must
// reconcile with the daily series exactly (single source — no second computation).
describe("rollUpDaysToMonths — savings calendar rollup (Item 2)", () => {
  it("groups days into months and keeps a chronological running cumulative", () => {
    const months = rollUpDaysToMonths([
      { day: "2026-05-30", total: 100 },
      { day: "2026-05-31", total: 50 },
      { day: "2026-06-01", total: 200 },
      { day: "2026-06-15", total: 25 },
    ]);

    expect(months).toEqual([
      { month: "2026-05", total: 150, cumulative: 150 },
      { month: "2026-06", total: 225, cumulative: 375 },
    ]);
  });

  it("sorts months chronologically even when input days are unordered", () => {
    const months = rollUpDaysToMonths([
      { day: "2026-06-01", total: 200 },
      { day: "2026-04-10", total: 40 },
      { day: "2026-05-05", total: 60 },
    ]);

    expect(months.map((m) => m.month)).toEqual(["2026-04", "2026-05", "2026-06"]);
    expect(months.map((m) => m.cumulative)).toEqual([40, 100, 300]);
    // Cumulative of the last month equals the sum of every day.
    expect(months.at(-1)?.cumulative).toBe(300);
  });

  it("returns an empty series for no data", () => {
    expect(rollUpDaysToMonths([])).toEqual([]);
  });
});
