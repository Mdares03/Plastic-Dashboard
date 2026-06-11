/**
 * R-rule constants (docs/METRICS_SPEC.md § Constants). Centralized so the rules
 * have exactly one numeric home. Existing freshness constants are re-exported,
 * never redefined, so the ladder (R8) and the rate freshness (R4) stay in sync
 * with the rest of the app.
 */
import { RECAP_HEARTBEAT_STALE_MS } from "@/lib/recap/recapUiConstants";

/** R4 — per-sample time-weight cap so a gap can't let one stale sample dominate. */
export const MAX_SAMPLE_WEIGHT_MS = 10 * 60 * 1000;

/** R4 — a "current" rate tile older than this renders null ("—"), never stale. */
export const CURRENT_RATE_MAX_AGE_MS = 10 * 60 * 1000;

/** R5 — an open (unresolved) downtime episode contributes at most this much. */
export const MAX_OPEN_EPISODE_MS = 12 * 60 * 60 * 1000;

/** R8 — staleness windows for the live machine-state ladder (extracted verbatim). */
export const STOP_ACTIVE_STALE_MS = 2 * 60 * 1000;
export const MOLD_ACTIVE_STALE_MS = 12 * 60 * 60 * 1000;

/** R8 — heartbeat staleness that defines `offline` (shared with recap UI). */
export { RECAP_HEARTBEAT_STALE_MS };
