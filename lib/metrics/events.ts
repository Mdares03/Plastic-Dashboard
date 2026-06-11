/**
 * Event payload parsing + episode detection — one home for logic that was
 * copy-pasted across ~10 files (lib/recap/*, lib/machines/withLatest.ts,
 * app/api/machines/[machineId]/route.ts, lib/reports/queries/*).
 *
 * `MachineEvent.data` is loose JSON (object, [object], or a JSON string of
 * either, sometimes nested under `.data`). These helpers parse it safely and
 * derive the live-state facts the R8 ladder needs. Per R5, events feed live
 * state + alerting only — never downtime KPIs (that is ReasonEntry, see
 * lib/metrics/downtime.ts).
 */
import type { EventRow } from "./types";

export function safeNum(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

export function isTruthyFlag(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    return normalized === "true" || normalized === "1" || normalized === "yes";
  }
  return false;
}

/** Unwrap `MachineEvent.data` (object | [object] | JSON string | nested .data). */
export function eventDataObject(data: unknown): Record<string, unknown> {
  let blob: unknown = data;
  if (typeof blob === "string") {
    try {
      blob = JSON.parse(blob);
    } catch {
      blob = null;
    }
  }
  if (Array.isArray(blob)) blob = blob[0];
  const record = blob && typeof blob === "object" ? (blob as Record<string, unknown>) : null;
  const innerCandidate = record?.data ?? record ?? {};
  return innerCandidate && typeof innerCandidate === "object"
    ? (innerCandidate as Record<string, unknown>)
    : {};
}

export function eventStatus(data: unknown): string {
  return String(eventDataObject(data).status ?? "").trim().toLowerCase();
}

export function eventDurationSec(data: unknown): number {
  const inner = eventDataObject(data);
  return (
    safeNum(inner.stoppage_duration_seconds) ??
    safeNum(inner.stop_duration_seconds) ??
    safeNum(inner.duration_seconds) ??
    safeNum(inner.duration_sec) ??
    safeNum(inner.durationSeconds) ??
    0
  );
}

/**
 * A terminal stop event (not a mid-incident "active"/update/auto-ack ping).
 * Only these carry a real measured duration.
 */
export function isRealStopEvent(data: unknown): boolean {
  const inner = eventDataObject(data);
  const status = String(inner.status ?? "").trim().toLowerCase();
  return (
    status !== "active" &&
    !isTruthyFlag(inner.is_update ?? inner.isUpdate) &&
    !isTruthyFlag(inner.is_auto_ack ?? inner.isAutoAck)
  );
}

export function eventIncidentKey(data: unknown, eventType: string, ts: Date): string {
  const inner = eventDataObject(data);
  const direct = String(inner.incidentKey ?? inner.incident_key ?? "").trim();
  if (direct) return direct;
  const alertId = String(inner.alert_id ?? inner.alertId ?? "").trim();
  if (alertId) return `${eventType}:${alertId}`;
  const startMs = safeNum(inner.start_ms) ?? safeNum(inner.startMs);
  if (startMs != null) return `${eventType}:${Math.trunc(startMs)}`;
  return `${eventType}:${ts.getTime()}`;
}

/**
 * Start (ms) of the most recent *active* (not resolved, not stale) episode of
 * `type`, grouped by incidentKey. Extracted verbatim from the machines route.
 */
export function activeEpisodeStartMs(
  rows: ReadonlyArray<EventRow>,
  type: string,
  nowMs: number,
  staleMs: number,
): number | null {
  const episodes = new Map<string, { firstTsMs: number; lastTsMs: number; lastStatus: string }>();
  for (const row of rows) {
    if (String(row.eventType || "").toLowerCase() !== type) continue;
    const data = eventDataObject(row.data);
    if (isTruthyFlag(data.is_auto_ack) || isTruthyFlag(data.isAutoAck)) continue;
    if (isTruthyFlag(data.is_update) || isTruthyFlag(data.isUpdate)) continue;
    const status = String(data.status ?? "").trim().toLowerCase();
    const incidentKey =
      String(data.incidentKey ?? data.incident_key ?? "").trim() || `${type}:${row.ts.getTime()}`;
    const tsMs = row.ts.getTime();
    const existing = episodes.get(incidentKey);
    if (!existing) {
      episodes.set(incidentKey, { firstTsMs: tsMs, lastTsMs: tsMs, lastStatus: status });
      continue;
    }
    existing.firstTsMs = Math.min(existing.firstTsMs, tsMs);
    if (tsMs >= existing.lastTsMs) {
      existing.lastTsMs = tsMs;
      existing.lastStatus = status;
    }
  }
  let bestStart: number | null = null;
  let bestTs = -Infinity;
  for (const ep of episodes.values()) {
    if (ep.lastStatus === "resolved") continue; // ended
    if (nowMs - ep.lastTsMs > staleMs) continue; // stale → assume ended
    if (ep.lastTsMs > bestTs) {
      bestTs = ep.lastTsMs;
      bestStart = ep.firstTsMs;
    }
  }
  return bestStart;
}

/**
 * End (ms) of the most recent *resolved* episode of `type` within the stale
 * window. For mold-change this is the "Finalizar cambio" boundary where the
 * startup-wait window begins. Extracted verbatim from the machines route.
 */
export function resolvedEpisodeEndMs(
  rows: ReadonlyArray<EventRow>,
  type: string,
  nowMs: number,
  staleMs: number,
): number | null {
  type Ep = { firstTsMs: number; lastTsMs: number; lastStatus: string; endMs: number | null };
  const episodes = new Map<string, Ep>();
  for (const row of rows) {
    if (String(row.eventType || "").toLowerCase() !== type) continue;
    const data = eventDataObject(row.data);
    if (isTruthyFlag(data.is_auto_ack) || isTruthyFlag(data.isAutoAck)) continue;
    if (isTruthyFlag(data.is_update) || isTruthyFlag(data.isUpdate)) continue;
    const status = String(data.status ?? "").trim().toLowerCase();
    const incidentKey =
      String(data.incidentKey ?? data.incident_key ?? "").trim() || `${type}:${row.ts.getTime()}`;
    const tsMs = row.ts.getTime();
    const endRaw = Number(data.end_ms ?? data.endMs);
    const endMs = Number.isFinite(endRaw) && endRaw > 0 ? endRaw : null;
    const existing = episodes.get(incidentKey);
    if (!existing) {
      episodes.set(incidentKey, { firstTsMs: tsMs, lastTsMs: tsMs, lastStatus: status, endMs });
      continue;
    }
    existing.firstTsMs = Math.min(existing.firstTsMs, tsMs);
    if (endMs != null) existing.endMs = Math.max(existing.endMs ?? endMs, endMs);
    if (tsMs >= existing.lastTsMs) {
      existing.lastTsMs = tsMs;
      existing.lastStatus = status;
    }
  }
  let bestEnd: number | null = null;
  let bestTs = -Infinity;
  for (const ep of episodes.values()) {
    if (ep.lastStatus !== "resolved") continue;
    const end = ep.endMs ?? ep.lastTsMs;
    if (nowMs - end > staleMs) continue; // too old → not a live wait
    if (ep.lastTsMs > bestTs) {
      bestTs = ep.lastTsMs;
      bestEnd = end;
    }
  }
  return bestEnd;
}
