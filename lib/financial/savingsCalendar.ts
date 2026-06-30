import { computeFinancialImpact } from "@/lib/financial/impact";
import type { FinancialDiagnostic } from "@/lib/financial/diagnostics";

export type SavingsMonth = {
  month: string; // YYYY-MM
  total: number;
  cumulative: number; // running sum within the window
};

export type SavingsDay = {
  day: string; // YYYY-MM-DD
  total: number;
};

export type SavingsCalendarCurrency = {
  currency: string;
  total: number;
  months: SavingsMonth[];
  byDay: SavingsDay[];
};

export type SavingsCalendarResult = {
  range: { start: Date; end: Date };
  currencies: SavingsCalendarCurrency[];
  diagnostic?: FinancialDiagnostic;
};

export const MAX_SAVINGS_MONTHS = 24;

/**
 * Pure rollup: per-day cost series → per-month totals with a running cumulative,
 * in chronological order. Extracted so the aggregation is unit-tested without a DB.
 */
export function rollUpDaysToMonths(byDay: SavingsDay[]): SavingsMonth[] {
  const monthTotals = new Map<string, number>();
  for (const d of byDay) {
    const month = d.day.slice(0, 7);
    monthTotals.set(month, (monthTotals.get(month) ?? 0) + d.total);
  }
  let cumulative = 0;
  return [...monthTotals.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, total]) => {
      cumulative += total;
      return { month, total, cumulative };
    });
}

/**
 * Item 2 — the savings calendar (up to 24 months). Built on top of the SAME
 * financial authority the financial page uses (`computeFinancialImpact`), so the
 * monthly/daily money here reconciles with the dashboard's loss figures by
 * construction. We make a single impact pass over the whole window and roll its
 * per-day series up into months (with a running cumulative) — no second source.
 *
 * "Savings" here = the recoverable cost of losses (downtime + scrap) per period;
 * the calendar shows where the money went so it can be targeted, mirroring the
 * per-reason "savings if resolved" framing on the Downtime page.
 */
export async function computeSavingsCalendar(params: {
  orgId: string;
  months?: number;
  machineId?: string;
  location?: string;
  currency?: string;
}): Promise<SavingsCalendarResult> {
  const monthsBack = Math.min(Math.max(1, Math.floor(params.months ?? MAX_SAVINGS_MONTHS)), MAX_SAVINGS_MONTHS);
  const end = new Date();
  // First day of the month `monthsBack - 1` months ago, so the window spans
  // exactly `monthsBack` calendar months ending with the current (partial) one.
  const start = new Date(end.getFullYear(), end.getMonth() - (monthsBack - 1), 1, 0, 0, 0, 0);

  const impact = await computeFinancialImpact({
    orgId: params.orgId,
    start,
    end,
    machineId: params.machineId,
    location: params.location,
    currency: params.currency,
    includeEvents: false,
  });

  const currencies: SavingsCalendarCurrency[] = impact.currencySummaries.map((summary) => {
    const byDay: SavingsDay[] = summary.byDay
      .map((d) => ({ day: d.day, total: d.total }))
      .sort((a, b) => a.day.localeCompare(b.day));

    const months = rollUpDaysToMonths(byDay);

    return { currency: summary.currency, total: summary.totals.total, months, byDay };
  });

  return { range: { start, end }, currencies, diagnostic: impact.diagnostic };
}
