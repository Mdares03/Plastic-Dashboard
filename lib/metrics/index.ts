/**
 * lib/metrics — the single KPI authority (docs/METRICS_SPEC.md, R1–R8).
 *
 * Every number on every screen traces to a numbered rule here, implemented once.
 * Views import from this module; they never recompute. Disagreement between data
 * sources is surfaced (checkCounterDrift), never silently resolved.
 *
 * Phase 3 migrates the 16 call sites onto these functions. This barrel is the
 * public surface.
 */
export * from "./types";
export * from "./spec";
export * from "./window";
export * from "./rates";
export * from "./production";
export * from "./downtime";
export * from "./machineState";
export {
  eventDataObject,
  eventStatus,
  eventDurationSec,
  isRealStopEvent,
  eventIncidentKey,
  activeEpisodeStartMs,
  resolvedEpisodeEndMs,
  safeNum,
  isTruthyFlag,
} from "./events";
