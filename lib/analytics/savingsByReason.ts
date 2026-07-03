/**
 * "Money story" for the Downtime page (Task B / Item 7). Turns per-reason MINUTE
 * rows + a loaded cost/min into per-reason money, so the rows sum to the Est. cost
 * KPI by construction (R5/#13 congruence — money tracks the SAME minute rows the
 * page shows, never a second money source).
 *
 * Placeholder-agnostic: it happily computes illustrative money under the 1/min
 * stub rate. Whether to badge those numbers as illustrative is the caller's call
 * (driven by costRate.placeholder), not this function's — it only needs a positive
 * cost/min to produce rows.
 */

export type SavingsInputRow = {
  reasonCode: string;
  reasonLabel: string;
  minutesLost?: number | null;
  count: number;
  pctOfTotal: number;
};

export type SavingsRow = {
  reasonCode: string;
  reasonLabel: string;
  minutes: number;
  count: number;
  pctOfTotal: number;
  cost: number;
};

export type SavingsByReason = {
  rows: SavingsRow[];
  total: number;
};

export function computeSavingsByReason(
  minuteRows: SavingsInputRow[],
  costPerMin: number
): SavingsByReason {
  // No positive rate ⇒ no money story (also guards NaN/negative).
  if (!(costPerMin > 0)) return { rows: [], total: 0 };

  const rows: SavingsRow[] = minuteRows
    .map((r) => {
      const minutes = r.minutesLost ?? 0;
      return {
        reasonCode: r.reasonCode,
        reasonLabel: r.reasonLabel,
        minutes,
        count: r.count,
        pctOfTotal: r.pctOfTotal,
        cost: minutes * costPerMin,
      };
    })
    .filter((r) => r.cost > 0);

  const total = rows.reduce((acc, r) => acc + r.cost, 0);
  return { rows, total };
}
