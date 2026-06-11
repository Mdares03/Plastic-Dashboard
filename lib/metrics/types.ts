/**
 * Shared row + result shapes for lib/metrics (the single KPI authority).
 *
 * The metric functions are PURE: they take already-fetched rows (these shapes)
 * and return computed numbers. This is what makes every R-rule unit-testable
 * with in-memory fixtures (tests/metrics/*) and runnable without a database —
 * the computation, where the pilot's incongruence bugs lived, is isolated from
 * the Prisma fetch layer.
 *
 * See docs/METRICS_SPEC.md (R1–R8). Code references rules by number.
 */

export type RateField = "oee" | "availability" | "performance" | "quality";

/** A `MachineKpiSnapshot` row, narrowed to what the rate rules (R4) need. */
export type KpiSample = {
  ts: Date;
  oee: number | null;
  availability: number | null;
  performance: number | null;
  quality: number | null;
  trackingEnabled: boolean | null;
  productionStarted: boolean | null;
};

/** A `MachineCycle` delta row (R2 window production / R3 reconciliation). */
export type CycleDelta = {
  ts: Date;
  cycleCount: number | null;
  goodDelta: number | null;
  scrapDelta: number | null;
  workOrderId: string | null;
};

/** A `MachineWorkOrder` row — the edge-maintained lifetime counters (R1). */
export type WorkOrderCounters = {
  workOrderId: string;
  status: string;
  goodParts: number;
  scrapParts: number;
  cycleCount: number;
};

/** A `ReasonEntry` row (R5 downtime / R2 manual scrap). */
export type ReasonRow = {
  kind: string;
  reasonCode: string;
  reasonLabel: string | null;
  durationSeconds: number | null;
  capturedAt: Date;
  episodeEndTs: Date | null;
  scrapQty: number | null;
  workOrderId: string | null;
};

/** A `MachineEvent` row — used for live state + alerting only (never downtime KPIs). */
export type EventRow = {
  eventType: string | null;
  ts: Date;
  data: unknown;
};

/** A time window, always carrying the resolution metadata (R6). */
export type ResolvedWindow = {
  start: Date;
  end: Date;
  mode: WindowMode;
  timezone: string;
  label: string;
};

export type WindowMode =
  | "today"
  | "yesterday"
  | "7d"
  | "30d"
  | "shift"
  | "live24h"
  | "custom";

export type RateSet = {
  oee: number | null;
  availability: number | null;
  performance: number | null;
  quality: number | null;
};

export type WindowProduction = {
  goodParts: number;
  scrapParts: number;
  cycleCount: number;
};

export type CounterDrift = {
  workOrderId: string;
  counterGood: number;
  cycleGood: number;
  goodDrift: number;
  counterScrap: number;
  cycleScrap: number;
  scrapDrift: number;
  counterCycles: number;
  cycleRows: number;
  cycleDrift: number;
  /** True when any of the three drifts is non-zero. */
  hasDrift: boolean;
};

export type DowntimeReasonBucket = {
  reasonCode: string;
  reasonLabel: string;
  minutes: number;
  count: number;
  planned: boolean;
};

export type DowntimeSummary = {
  totalMin: number;
  plannedMin: number;
  unplannedMin: number;
  byReason: DowntimeReasonBucket[];
};
