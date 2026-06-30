/**
 * Period-over-period headline-KPI deltas (item 1). The email/report shows "this
 * period vs the prior period of equal length" so the decision-maker sees movement,
 * not just a snapshot. Pure + unit-tested; both inputs come from the same
 * buildWeeklyReport authority (current window and the immediately-preceding one).
 */

/** The headline KPIs the comparison needs from each period. */
export interface HeadlineKpis {
  period: { from: string; to: string };
  oeeAvg: number;
  production: { good: number; pct: number };
  estimatedLossMXN: number;
  classificationRate: number;
}

export interface KpiComparison {
  previousPeriod: { from: string; to: string };
  previous: {
    oeeAvg: number;
    productionGood: number;
    productionPct: number;
    estimatedLossMXN: number;
    classificationRate: number;
  };
  /**
   * current − previous. Percentage metrics are in points. `estimatedLossMXN` is a
   * money delta where negative = improvement (loss went down).
   */
  deltas: {
    oeeAvgPts: number;
    productionGood: number;
    productionPctPts: number;
    estimatedLossMXN: number;
    classificationRatePts: number;
  };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

export function computeKpiComparison(current: HeadlineKpis, previous: HeadlineKpis): KpiComparison {
  return {
    previousPeriod: { from: previous.period.from, to: previous.period.to },
    previous: {
      oeeAvg: previous.oeeAvg,
      productionGood: previous.production.good,
      productionPct: previous.production.pct,
      estimatedLossMXN: previous.estimatedLossMXN,
      classificationRate: previous.classificationRate,
    },
    deltas: {
      oeeAvgPts: round1(current.oeeAvg - previous.oeeAvg),
      productionGood: current.production.good - previous.production.good,
      productionPctPts: round1(current.production.pct - previous.production.pct),
      estimatedLossMXN: round1(current.estimatedLossMXN - previous.estimatedLossMXN),
      classificationRatePts: round1((current.classificationRate - previous.classificationRate) * 100),
    },
  };
}
