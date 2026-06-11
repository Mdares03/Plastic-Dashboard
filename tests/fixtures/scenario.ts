/**
 * In-memory fixture builders for the metrics golden tests.
 *
 * The lib/metrics functions are pure over row shapes, so a "seeded scenario" is
 * just typed objects — no database required. This keeps `npm test` runnable
 * anywhere (CI included) and makes every golden number hand-checkable against
 * docs/METRICS_SPEC.md. The Prisma fetch wrappers are exercised separately by
 * the read-only drift check against prod (Phase 5).
 */
import type {
  CycleDelta,
  EventRow,
  KpiSample,
  ReasonRow,
  WorkOrderCounters,
} from "@/lib/metrics/types";

/** A fixed anchor instant so every golden number is deterministic. */
export const T0 = new Date("2026-06-01T00:00:00.000Z");
export const MIN = 60 * 1000;
export const HOUR = 60 * MIN;

export function at(offsetMs: number): Date {
  return new Date(T0.getTime() + offsetMs);
}

export function kpi(partial: Partial<KpiSample> & { ts: Date }): KpiSample {
  return {
    oee: null,
    availability: null,
    performance: null,
    quality: null,
    trackingEnabled: true,
    productionStarted: true,
    ...partial,
  };
}

export function cycle(partial: Partial<CycleDelta> & { ts: Date }): CycleDelta {
  return {
    cycleCount: null,
    goodDelta: 0,
    scrapDelta: 0,
    workOrderId: null,
    ...partial,
  };
}

export function workOrder(partial: Partial<WorkOrderCounters> & { workOrderId: string }): WorkOrderCounters {
  return {
    status: "COMPLETED",
    goodParts: 0,
    scrapParts: 0,
    cycleCount: 0,
    ...partial,
  };
}

export function reason(partial: Partial<ReasonRow> & { capturedAt: Date }): ReasonRow {
  return {
    kind: "downtime",
    reasonCode: "UNPLANNED",
    reasonLabel: null,
    durationSeconds: 0,
    episodeEndTs: null,
    scrapQty: null,
    workOrderId: null,
    ...partial,
  };
}

/** Build a MachineEvent row with a JSON `data` payload, like the edge sends. */
export function event(
  eventType: string,
  ts: Date,
  data: Record<string, unknown> = {},
): EventRow {
  return { eventType, ts, data };
}
