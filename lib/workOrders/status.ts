/**
 * Canonical work-order lifecycle status vocabulary (METRICS_SPEC R1/R3).
 *
 * The edge writes `status='DONE'` in its local MariaDB when an operator completes
 * a work order; older/imported rows may carry `COMPLETED` or `CLOSED`. Before this
 * helper the dashboard disagreed with itself — the "open WO" filters excluded
 * {COMPLETED,DONE,CLOSED,CANCELLED} (so DONE = closed), but the R3 reconciliation
 * and the consistency health check counted ONLY `COMPLETED`, so a DONE work order
 * would be treated as both "closed" and "never completed". One vocabulary here.
 *
 * - COMPLETED set: a WO that ran to its end with final counters worth reconciling
 *   against cycle-delta sums (R3). CANCELLED is deliberately excluded — an aborted
 *   WO's counters are not expected to reconcile.
 * - TERMINAL set: any non-open status (COMPLETED set + CANCELLED). Used by the
 *   "currently open / active WO" filters.
 *
 * Compare case-insensitively; statuses are stored uppercase but stay tolerant.
 */
export const COMPLETED_WO_STATUSES = ["COMPLETED", "DONE", "CLOSED"] as const;
export const TERMINAL_WO_STATUSES = [...COMPLETED_WO_STATUSES, "CANCELLED"] as const;

const COMPLETED_SET = new Set<string>(COMPLETED_WO_STATUSES);
const TERMINAL_SET = new Set<string>(TERMINAL_WO_STATUSES);

const norm = (status: string | null | undefined): string =>
  String(status ?? "").trim().toUpperCase();

/** A WO that finished with final counters (reconcilable in R3). Excludes CANCELLED. */
export function isCompletedWorkOrder(status: string | null | undefined): boolean {
  return COMPLETED_SET.has(norm(status));
}

/** Any non-open status (completed or cancelled) — i.e. NOT a currently-open WO. */
export function isTerminalWorkOrder(status: string | null | undefined): boolean {
  return TERMINAL_SET.has(norm(status));
}

/** A WO still open/active (the negation of {@link isTerminalWorkOrder}). */
export function isOpenWorkOrder(status: string | null | undefined): boolean {
  return !isTerminalWorkOrder(status);
}
