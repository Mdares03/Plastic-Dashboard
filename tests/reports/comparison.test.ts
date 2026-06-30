import { describe, expect, it } from "vitest";
import { computeKpiComparison, type HeadlineKpis } from "@/lib/reports/comparison";

// Item 1: period-over-period headline-KPI deltas. current − previous, percentages in
// points, loss delta where negative = improvement.
describe("computeKpiComparison", () => {
  const previous: HeadlineKpis = {
    period: { from: "2026-06-16T00:00:00.000Z", to: "2026-06-23T00:00:00.000Z" },
    oeeAvg: 70,
    production: { good: 1000, pct: 80 },
    estimatedLossMXN: 5000,
    classificationRate: 0.6,
  };
  const current: HeadlineKpis = {
    period: { from: "2026-06-23T00:00:00.000Z", to: "2026-06-30T00:00:00.000Z" },
    oeeAvg: 75.4,
    production: { good: 1200, pct: 85 },
    estimatedLossMXN: 4200,
    classificationRate: 0.72,
  };

  it("computes point/money deltas and carries the prior period window", () => {
    const c = computeKpiComparison(current, previous);
    expect(c.previousPeriod).toEqual(previous.period);
    expect(c.deltas.oeeAvgPts).toBe(5.4);
    expect(c.deltas.productionGood).toBe(200);
    expect(c.deltas.productionPctPts).toBe(5);
    expect(c.deltas.estimatedLossMXN).toBe(-800); // loss fell → negative = better
    expect(c.deltas.classificationRatePts).toBe(12);
    expect(c.previous.oeeAvg).toBe(70);
  });
});
