/**
 * Recap & work-order progress: large targets (e.g. 301k) make raw % < 1.
 * Rounding to integer shows 0%; bar width 0.17% is invisible. Use decimals + a visual floor for the bar.
 */

/** "0.17%" with enough precision when needed; "—" for null. */
export function formatRecapProgressPercent(
  pct: number | null | undefined,
  locale: string
): string {
  if (pct == null || Number.isNaN(pct)) return "—";
  if (pct <= 0) return "0%";
  if (pct < 10) {
    return `${pct.toLocaleString(locale, { maximumFractionDigits: 2, minimumFractionDigits: 0 })}%`;
  }
  return `${Math.round(pct).toLocaleString(locale)}%`;
}

/**
 * For CSS width %: keep proportional when ≥2%; below that, any positive progress
 * needs a minimum or the bar looks like a single pixel.
 */
export function progressBarWidthPercent(pct: number | null | undefined): number {
  if (pct == null || Number.isNaN(pct) || pct <= 0) return 0;
  if (pct < 2) return Math.max(2, Math.min(100, pct));
  return Math.min(100, pct);
}
