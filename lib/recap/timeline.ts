import type { RecapTimelineSegment } from "@/lib/recap/types";

const ACTIVE_STALE_MS = 2 * 60 * 1000;
const MOLD_ACTIVE_STALE_MS = 12 * 60 * 60 * 1000;
const MERGE_GAP_MS = 30 * 1000;
const MICRO_CLUSTER_GAP_MS = 60 * 1000;
const ABSORB_SHORT_SEGMENT_MS = 30 * 1000;

export const TIMELINE_EVENT_TYPES = ["mold-change", "macrostop", "microstop"] as const;

type TimelineEventType = (typeof TIMELINE_EVENT_TYPES)[number];

type RawSegment =
  | {
      type: "production";
      startMs: number;
      endMs: number;
      priority: number;
      workOrderId: string | null;
      sku: string | null;
      label: string;
    }
  | {
      type: "mold-change";
      startMs: number;
      endMs: number;
      priority: number;
      fromMoldId: string | null;
      toMoldId: string | null;
      durationSec: number;
      label: string;
    }
  | {
      type: "macrostop" | "microstop" | "slow-cycle";
      startMs: number;
      endMs: number;
      priority: number;
      reason: string | null;
      durationSec: number;
      label: string;
    };

export type TimelineCycleRow = {
  ts: Date;
  cycleCount: number | null;
  actualCycleTime: number;
  theoreticalCycleTime: number | null;
  workOrderId: string | null;
  sku: string | null;
};

export type TimelineEventRow = {
  ts: Date;
  eventType: string;
  data: unknown;
};

const PRIORITY: Record<string, number> = {
  idle: 0,
  production: 1,
  microstop: 2,
  "slow-cycle": 2,
  macrostop: 3,
  "mold-change": 4,
};

function safeNum(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function safeBool(value: unknown) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (!normalized) return false;
    return normalized === "true" || normalized === "1" || normalized === "yes";
  }
  return false;
}

function normalizeToken(value: unknown) {
  return String(value ?? "").trim();
}

function dedupeByKey<T>(rows: T[], keyFn: (row: T) => string) {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const row of rows) {
    const key = keyFn(row);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

function extractData(value: unknown) {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      parsed = null;
    }
  }
  const record =
    typeof parsed === "object" && parsed && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  const nested = record.data;
  if (typeof nested === "object" && nested && !Array.isArray(nested)) {
    return nested as Record<string, unknown>;
  }
  return record;
}

function clampToRange(startMs: number, endMs: number, rangeStartMs: number, rangeEndMs: number) {
  const clampedStart = Math.max(rangeStartMs, Math.min(rangeEndMs, startMs));
  const clampedEnd = Math.max(rangeStartMs, Math.min(rangeEndMs, endMs));
  if (clampedEnd <= clampedStart) return null;
  return { startMs: clampedStart, endMs: clampedEnd };
}

function eventIncidentKey(eventType: string, data: Record<string, unknown>, fallbackTsMs: number) {
  const key = String(data.incidentKey ?? data.incident_key ?? "").trim();
  if (key) return key;
  const alertId = String(data.alert_id ?? data.alertId ?? "").trim();
  if (alertId) return `${eventType}:${alertId}`;
  const startMs = safeNum(data.start_ms) ?? safeNum(data.startMs);
  if (startMs != null) return `${eventType}:${Math.trunc(startMs)}`;
  return `${eventType}:${fallbackTsMs}`;
}

function reasonLabelFromData(data: Record<string, unknown>) {
  const direct =
    String(data.reasonText ?? data.reason_label ?? data.reasonLabel ?? "").trim() || null;
  if (direct) return direct;

  const reason = data.reason;
  if (typeof reason === "string") {
    const text = reason.trim();
    return text || null;
  }
  if (reason && typeof reason === "object" && !Array.isArray(reason)) {
    const rec = reason as Record<string, unknown>;
    const reasonText =
      String(rec.reasonText ?? rec.reason_label ?? rec.reasonLabel ?? "").trim() || null;
    if (reasonText) return reasonText;
    const detail =
      String(rec.detailLabel ?? rec.detail_label ?? rec.detailId ?? rec.detail_id ?? "").trim() ||
      null;
    const category =
      String(rec.categoryLabel ?? rec.category_label ?? rec.categoryId ?? rec.category_id ?? "").trim() ||
      null;
    if (category && detail) return `${category} > ${detail}`;
    if (detail) return detail;
    if (category) return category;
  }
  return null;
}

function labelForStop(type: "macrostop" | "microstop" | "slow-cycle", reason: string | null) {
  if (type === "macrostop") return reason ? `Paro: ${reason}` : "Paro";
  if (type === "microstop") return reason ? `Microparo: ${reason}` : "Microparo";
  return reason ? `Ciclo lento: ${reason}` : "Ciclo lento";
}

function normalizeStopType(type: "macrostop" | "microstop" | "slow-cycle"): "macrostop" | "microstop" {
  return type === "macrostop" ? "macrostop" : "microstop";
}

function isEquivalent(a: RecapTimelineSegment, b: RecapTimelineSegment) {
  if (a.type !== b.type) return false;
  if (a.type === "idle" && b.type === "idle") return true;
  if (a.type === "production" && b.type === "production") {
    return a.workOrderId === b.workOrderId && a.sku === b.sku && a.label === b.label;
  }
  if (a.type === "mold-change" && b.type === "mold-change") {
    return a.fromMoldId === b.fromMoldId && a.toMoldId === b.toMoldId;
  }
  if (
    (a.type === "macrostop" || a.type === "microstop" || a.type === "slow-cycle") &&
    (b.type === "macrostop" || b.type === "microstop" || b.type === "slow-cycle")
  ) {
    return a.type === b.type && a.reason === b.reason;
  }
  return false;
}

function withDuration(segment: RecapTimelineSegment): RecapTimelineSegment {
  if (segment.type === "production") {
    return {
      ...segment,
      durationSec: Math.max(0, Math.trunc((segment.endMs - segment.startMs) / 1000)),
    };
  }
  if (segment.type === "mold-change") {
    return {
      ...segment,
      durationSec: Math.max(0, Math.trunc((segment.endMs - segment.startMs) / 1000)),
    };
  }
  if (segment.type === "macrostop" || segment.type === "microstop" || segment.type === "slow-cycle") {
    return {
      ...segment,
      durationSec: Math.max(0, Math.trunc((segment.endMs - segment.startMs) / 1000)),
    };
  }
  return {
    ...segment,
    durationSec: Math.max(0, Math.trunc((segment.endMs - segment.startMs) / 1000)),
  };
}

function cloneSegment(segment: RecapTimelineSegment): RecapTimelineSegment {
  return { ...segment };
}

function mergeNearbyEquivalentSegments(segments: RecapTimelineSegment[], maxGapMs: number) {
  const ordered = [...segments]
    .map((segment) => withDuration(segment))
    .filter((segment) => segment.endMs > segment.startMs)
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);

  const merged: RecapTimelineSegment[] = [];
  for (const current of ordered) {
    const prev = merged[merged.length - 1];
    if (!prev) {
      merged.push(cloneSegment(current));
      continue;
    }

    const gapMs = current.startMs - prev.endMs;
    if (gapMs <= maxGapMs && isEquivalent(prev, current)) {
      prev.endMs = Math.max(prev.endMs, current.endMs);
      const normalized = withDuration(prev);
      Object.assign(prev, normalized);
      continue;
    }

    if (current.startMs < prev.endMs) {
      const clipped = { ...current, startMs: prev.endMs };
      if (clipped.endMs <= clipped.startMs) continue;
      merged.push(withDuration(clipped));
      continue;
    }

    merged.push(cloneSegment(current));
  }

  return merged;
}

function fillGapsWithIdle(segments: RecapTimelineSegment[], rangeStartMs: number, rangeEndMs: number) {
  const ordered = [...segments]
    .map((segment) => {
      const startMs = Math.max(rangeStartMs, segment.startMs);
      const endMs = Math.min(rangeEndMs, segment.endMs);
      if (endMs <= startMs) return null;
      return withDuration({ ...segment, startMs, endMs });
    })
    .filter((segment): segment is RecapTimelineSegment => !!segment)
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);

  const out: RecapTimelineSegment[] = [];
  let cursor = rangeStartMs;

  for (const segment of ordered) {
    if (segment.startMs > cursor) {
      out.push({
        type: "idle",
        startMs: cursor,
        endMs: segment.startMs,
        durationSec: Math.max(0, Math.trunc((segment.startMs - cursor) / 1000)),
        label: "Idle",
      });
    }

    const startMs = Math.max(cursor, segment.startMs);
    const endMs = Math.min(rangeEndMs, segment.endMs);
    if (endMs <= startMs) continue;

    out.push(withDuration({ ...segment, startMs, endMs }));
    cursor = endMs;
    if (cursor >= rangeEndMs) break;
  }

  if (cursor < rangeEndMs) {
    out.push({
      type: "idle",
      startMs: cursor,
      endMs: rangeEndMs,
      durationSec: Math.max(0, Math.trunc((rangeEndMs - cursor) / 1000)),
      label: "Idle",
    });
  }

  return mergeNearbyEquivalentSegments(out, 0);
}

function absorbMicroStopClusters(segments: RecapTimelineSegment[], maxGapMs: number) {
  const out: RecapTimelineSegment[] = [];
  let i = 0;

  while (i < segments.length) {
    const first = segments[i];
    if (first.type !== "microstop") {
      out.push(cloneSegment(first));
      i += 1;
      continue;
    }

    let clusterEndMs = first.endMs;
    let count = 1;
    const reasons = new Set<string>();
    if (first.reason) reasons.add(first.reason);

    let cursor = i;
    while (cursor + 2 < segments.length) {
      const gap = segments[cursor + 1];
      const next = segments[cursor + 2];
      if (next.type !== "microstop") break;
      if (gap.type === "macrostop" || gap.type === "mold-change") break;
      const gapMs = Math.max(0, gap.endMs - gap.startMs);
      if (gapMs >= maxGapMs) break;

      clusterEndMs = next.endMs;
      if (next.reason) reasons.add(next.reason);
      count += 1;
      cursor += 2;
    }

    if (count === 1) {
      out.push(cloneSegment(first));
      i += 1;
      continue;
    }

    const reason = reasons.size === 1 ? (Array.from(reasons)[0] ?? null) : null;
    out.push({
      type: "microstop",
      startMs: first.startMs,
      endMs: clusterEndMs,
      reason,
      reasonLabel: reason,
      durationSec: Math.max(0, Math.trunc((clusterEndMs - first.startMs) / 1000)),
      label: reason ? `Microparo (${count}) · ${reason}` : `Microparo (${count})`,
    });
    i = cursor + 1;
  }

  return mergeNearbyEquivalentSegments(out, 0);
}

function absorbShortSegments(segments: RecapTimelineSegment[], minDurationMs: number) {
  const out = segments.map((segment) => withDuration(cloneSegment(segment)));
  let index = 0;

  while (index < out.length) {
    const current = out[index];
    const durationMs = Math.max(0, current.endMs - current.startMs);
    if (durationMs >= minDurationMs || out.length === 1) {
      index += 1;
      continue;
    }

    const prev = out[index - 1] ?? null;
    const next = out[index + 1] ?? null;
    if (!prev && !next) break;

    if (!prev && next) {
      next.startMs = current.startMs;
      out.splice(index, 1);
      continue;
    }

    if (prev && !next) {
      prev.endMs = current.endMs;
      out.splice(index, 1);
      index = Math.max(0, index - 1);
      continue;
    }

    const prevDurationMs = Math.max(0, (prev?.endMs ?? 0) - (prev?.startMs ?? 0));
    const nextDurationMs = Math.max(0, (next?.endMs ?? 0) - (next?.startMs ?? 0));
    const absorbIntoPrev = prevDurationMs >= nextDurationMs;

    if (absorbIntoPrev && prev) {
      prev.endMs = current.endMs;
      out.splice(index, 1);
      index = Math.max(0, index - 1);
      continue;
    }

    if (next) {
      next.startMs = current.startMs;
      out.splice(index, 1);
      continue;
    }

    index += 1;
  }

  return mergeNearbyEquivalentSegments(out.map((segment) => withDuration(segment)), MERGE_GAP_MS);
}

function buildSegmentsFromBoundaries(rawSegments: RawSegment[], rangeStartMs: number, rangeEndMs: number) {
  const clipped = rawSegments
    .map((segment) => {
      const range = clampToRange(segment.startMs, segment.endMs, rangeStartMs, rangeEndMs);
      return range ? { ...segment, ...range } : null;
    })
    .filter((segment): segment is RawSegment => !!segment);

  const boundaries = new Set<number>([rangeStartMs, rangeEndMs]);
  for (const segment of clipped) {
    boundaries.add(segment.startMs);
    boundaries.add(segment.endMs);
  }
  const orderedBoundaries = Array.from(boundaries).sort((a, b) => a - b);

  const timeline: RecapTimelineSegment[] = [];
  for (let i = 0; i < orderedBoundaries.length - 1; i += 1) {
    const intervalStart = orderedBoundaries[i];
    const intervalEnd = orderedBoundaries[i + 1];
    if (intervalEnd <= intervalStart) continue;

    const covering = clipped
      .filter((segment) => segment.startMs < intervalEnd && segment.endMs > intervalStart)
      .sort((a, b) => b.priority - a.priority || b.startMs - a.startMs);

    const winner = covering[0];
    if (!winner) continue;

    if (winner.type === "production") {
      timeline.push({
        type: "production",
        startMs: intervalStart,
        endMs: intervalEnd,
        durationSec: Math.max(0, Math.trunc((intervalEnd - intervalStart) / 1000)),
        workOrderId: winner.workOrderId,
        sku: winner.sku,
        label: winner.label,
      });
      continue;
    }

    if (winner.type === "mold-change") {
      timeline.push({
        type: "mold-change",
        startMs: intervalStart,
        endMs: intervalEnd,
        fromMoldId: winner.fromMoldId,
        toMoldId: winner.toMoldId,
        durationSec: Math.max(0, Math.trunc((intervalEnd - intervalStart) / 1000)),
        label: winner.label,
      });
      continue;
    }

    const stopType = normalizeStopType(winner.type);
    timeline.push({
      type: stopType,
      startMs: intervalStart,
      endMs: intervalEnd,
      reason: winner.reason,
      reasonLabel: winner.reason,
      durationSec: Math.max(0, Math.trunc((intervalEnd - intervalStart) / 1000)),
      label: labelForStop(stopType, winner.reason),
    });
  }

  return timeline;
}

function segmentPriority(type: RecapTimelineSegment["type"]) {
  if (type === "mold-change") return 4;
  if (type === "macrostop") return 3;
  if (type === "microstop" || type === "slow-cycle") return 2;
  if (type === "production") return 1;
  return 0;
}

function cloneForRange(segment: RecapTimelineSegment, startMs: number, endMs: number): RecapTimelineSegment {
  if (segment.type === "production") {
    return {
      type: "production",
      startMs,
      endMs,
      durationSec: Math.max(0, Math.trunc((endMs - startMs) / 1000)),
      workOrderId: segment.workOrderId,
      sku: segment.sku,
      label: segment.label,
    };
  }
  if (segment.type === "mold-change") {
    return {
      type: "mold-change",
      startMs,
      endMs,
      fromMoldId: segment.fromMoldId,
      toMoldId: segment.toMoldId,
      durationSec: Math.max(0, Math.trunc((endMs - startMs) / 1000)),
      label: segment.label,
    };
  }
  if (segment.type === "macrostop" || segment.type === "microstop" || segment.type === "slow-cycle") {
    const stopType = normalizeStopType(segment.type);
    return {
      type: stopType,
      startMs,
      endMs,
      reason: segment.reason,
      reasonLabel: segment.reasonLabel ?? segment.reason,
      durationSec: Math.max(0, Math.trunc((endMs - startMs) / 1000)),
      label: segment.label,
    };
  }
  return {
    type: "idle",
    startMs,
    endMs,
    durationSec: Math.max(0, Math.trunc((endMs - startMs) / 1000)),
    label: segment.label,
  };
}

export function buildTimelineSegments(input: {
  cycles: TimelineCycleRow[];
  events: TimelineEventRow[];
  rangeStart: Date;
  rangeEnd: Date;
}) {
  const rangeStartMs = input.rangeStart.getTime();
  const rangeEndMs = input.rangeEnd.getTime();

  if (!Number.isFinite(rangeStartMs) || !Number.isFinite(rangeEndMs) || rangeEndMs <= rangeStartMs) {
    return [] as RecapTimelineSegment[];
  }

  const dedupedCycles = dedupeByKey(
    input.cycles,
    (cycle) =>
      `${cycle.ts.getTime()}:${safeNum(cycle.cycleCount) ?? "na"}:${normalizeToken(cycle.workOrderId).toUpperCase()}:${normalizeToken(cycle.sku).toUpperCase()}:${safeNum(cycle.actualCycleTime) ?? "na"}`
  );

  const rawSegments: RawSegment[] = [];

  let currentProduction: RawSegment | null = null;
  for (const cycle of dedupedCycles) {
    if (!cycle.workOrderId) continue;
    // Pi stores cycle.ts at COMPLETION time; the cycle ran in [ts - actual, ts].
    const completionMs = cycle.ts.getTime();
    const cycleDurationMs = Math.max(
      1000,
      Math.min(600000, Math.trunc((safeNum(cycle.actualCycleTime) ?? 1) * 1000))
    );
    const cycleStartMs = completionMs - cycleDurationMs;
    const cycleEndMs = completionMs;

    if (
      currentProduction &&
      currentProduction.type === "production" &&
      currentProduction.workOrderId === cycle.workOrderId &&
      currentProduction.sku === cycle.sku &&
      cycleStartMs <= currentProduction.endMs + MERGE_GAP_MS
    ) {
      currentProduction.endMs = Math.max(currentProduction.endMs, cycleEndMs);
      continue;
    }

    if (currentProduction) rawSegments.push(currentProduction);
    currentProduction = {
      type: "production",
      startMs: cycleStartMs,
      endMs: cycleEndMs,
      priority: PRIORITY.production,
      workOrderId: cycle.workOrderId,
      sku: cycle.sku,
      label: cycle.workOrderId,
    };
  }
  if (currentProduction) rawSegments.push(currentProduction);

  // If production evidence appears after a mold-change "active" event, we cap that
  // mold-change segment at the first production timestamp to avoid stale overwrite.
  const productionWindows = rawSegments
    .filter((segment): segment is Extract<RawSegment, { type: "production" }> => segment.type === "production")
    .map((segment) => ({ startMs: segment.startMs, endMs: segment.endMs }))
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);

  const firstProductionMsAfter = (startMs: number) => {
    for (const window of productionWindows) {
      if (window.endMs <= startMs) continue;
      return Math.max(startMs, window.startMs);
    }
    return null;
  };

  const eventEpisodes = new Map<
    string,
    {
      type: "mold-change" | "macrostop" | "microstop";
      firstTsMs: number;
      lastTsMs: number;
      startMs: number | null;
      endMs: number | null;
      durationSec: number | null;
      statusActive: boolean;
      statusResolved: boolean;
      reason: string | null;
      fromMoldId: string | null;
      toMoldId: string | null;
    }
  >();

  for (const event of input.events) {
    const eventType = String(event.eventType || "").toLowerCase() as TimelineEventType;
    if (!TIMELINE_EVENT_TYPES.includes(eventType)) continue;

    const data = extractData(event.data);
    const isAutoAck = safeBool(data.is_auto_ack ?? data.isAutoAck);
    if (isAutoAck) continue;

    const tsMs = event.ts.getTime();
    const key = eventIncidentKey(eventType, data, tsMs);
    const status = String(data.status ?? "").trim().toLowerCase();

    let episode = eventEpisodes.get(key);
    if (!episode) {
      episode = {
        type: eventType,
        firstTsMs: tsMs,
        lastTsMs: tsMs,
        startMs: null,
        endMs: null,
        durationSec: null,
        statusActive: false,
        statusResolved: false,
        reason: null,
        fromMoldId: null,
        toMoldId: null,
      };
    } else if ((PRIORITY[eventType] ?? 0) > (PRIORITY[episode.type] ?? 0)) {
      // Upgrade type when escalation is detected within the same incidentKey
      // (e.g. microstop → macrostop preserves the same key by design)
      episode.type = eventType;
    }
    episode.firstTsMs = Math.min(episode.firstTsMs, tsMs);
    episode.lastTsMs = Math.max(episode.lastTsMs, tsMs);

    const startMs =
      safeNum(data.start_ms) ??
      safeNum(data.startMs) ??
      safeNum(data.last_cycle_timestamp) ??
      safeNum(data.lastCycleTimestamp);
    const endMs = safeNum(data.end_ms) ?? safeNum(data.endMs);
    const durationSec =
      safeNum(data.duration_sec) ??
      safeNum(data.stoppage_duration_seconds) ??
      safeNum(data.stop_duration_seconds) ??
      safeNum(data.duration_seconds);

    if (startMs != null) episode.startMs = episode.startMs == null ? startMs : Math.min(episode.startMs, startMs);
    if (endMs != null) episode.endMs = episode.endMs == null ? endMs : Math.max(episode.endMs, endMs);
    if (durationSec != null) episode.durationSec = Math.max(0, Math.trunc(durationSec));

    if (status === "active") episode.statusActive = true;
    if (status === "resolved") episode.statusResolved = true;

    const reason = reasonLabelFromData(data);
    if (reason) episode.reason = reason;

    const fromMoldId = String(data.from_mold_id ?? data.fromMoldId ?? "").trim() || null;
    const toMoldId = String(data.to_mold_id ?? data.toMoldId ?? "").trim() || null;
    if (fromMoldId) episode.fromMoldId = fromMoldId;
    if (toMoldId) episode.toMoldId = toMoldId;

    eventEpisodes.set(key, episode);
  }

  for (const episode of eventEpisodes.values()) {
    let startMs = Math.trunc(episode.startMs ?? episode.firstTsMs);
    let endMs = Math.trunc(episode.endMs ?? episode.lastTsMs);

    if (episode.statusActive && !episode.statusResolved) {
      const activeStaleMs = episode.type === "mold-change" ? MOLD_ACTIVE_STALE_MS : ACTIVE_STALE_MS;
      const isFreshActive = rangeEndMs - episode.lastTsMs <= activeStaleMs;
      endMs = isFreshActive ? rangeEndMs : episode.lastTsMs;

      if (episode.type === "mold-change") {
        const productionResumeMs = firstProductionMsAfter(startMs);
        if (productionResumeMs != null) {
          endMs = Math.min(endMs, productionResumeMs);
        }
      }
    } else if (endMs <= startMs && episode.durationSec != null && episode.durationSec > 0) {
      // Event ts is end-of-stop; subtract duration to recover start.
      // Only adjust if we don't already have an explicit startMs from data.
      if (episode.startMs == null) {
        startMs = endMs - episode.durationSec * 1000;
      } else {
        endMs = startMs + episode.durationSec * 1000;
      }
    }

    if (endMs <= startMs) continue;

    if (episode.type === "mold-change") {
      rawSegments.push({
        type: "mold-change",
        startMs,
        endMs,
        priority: PRIORITY["mold-change"],
        fromMoldId: episode.fromMoldId,
        toMoldId: episode.toMoldId,
        durationSec: Math.max(0, Math.trunc((endMs - startMs) / 1000)),
        label: episode.toMoldId ? `Cambio molde ${episode.toMoldId}` : "Cambio molde",
      });
      continue;
    }

    rawSegments.push({
      type: episode.type,
      startMs,
      endMs,
      priority: PRIORITY[episode.type],
      reason: episode.reason,
      durationSec: Math.max(0, Math.trunc((endMs - startMs) / 1000)),
      label: labelForStop(episode.type, episode.reason),
    });
  }

  const initial = buildSegmentsFromBoundaries(rawSegments, rangeStartMs, rangeEndMs);
  const merged = mergeNearbyEquivalentSegments(initial, MERGE_GAP_MS);
  const withIdle = fillGapsWithIdle(merged, rangeStartMs, rangeEndMs);
  const clustered = absorbMicroStopClusters(withIdle, MICRO_CLUSTER_GAP_MS);
  const normalized = fillGapsWithIdle(clustered, rangeStartMs, rangeEndMs);
  const absorbed = absorbShortSegments(normalized, ABSORB_SHORT_SEGMENT_MS);
 const finalSegments = fillGapsWithIdle(absorbed, rangeStartMs, rangeEndMs);

  // Live tail: machine cycling now, last cycle not yet completed.
  // Extend production through right edge until microstop threshold passes.
  const lastCycle = dedupedCycles[dedupedCycles.length - 1];
  const idealCT = safeNum(lastCycle?.theoreticalCycleTime) ?? 120;
  const MICRO_MS = idealCT * 1.5 * 1000;

  // Live-tail: extend whatever the last real state was, until microstop threshold passes.
  if (finalSegments.length >= 2) {
    const last = finalSegments[finalSegments.length - 1];
    const prev = finalSegments[finalSegments.length - 2];
    if (last.type === "idle" && last.endMs >= rangeEndMs - 2000) {
      const gapMs = last.endMs - prev.endMs;
      let shouldExtend = false;
      if (prev.type === "production" && gapMs < MICRO_MS) {
        // mid-cycle: still running up to microstop threshold
        shouldExtend = true;
      } else if (prev.type === "microstop" || prev.type === "macrostop") {
        // stoppage in progress: extend until resolved/next cycle
        shouldExtend = true;
      }
      if (shouldExtend) {
        prev.endMs = last.endMs;
        prev.durationSec = Math.max(0, Math.trunc((prev.endMs - prev.startMs) / 1000));
        finalSegments.pop();
      }
    }
  }

  return finalSegments;
}

export function compressTimelineSegments(input: {
  segments: RecapTimelineSegment[];
  rangeStart: Date;
  rangeEnd: Date;
  maxSegments: number;
}) {
  const rangeStartMs = input.rangeStart.getTime();
  const rangeEndMs = input.rangeEnd.getTime();
  const maxSegments = Math.max(1, Math.trunc(input.maxSegments || 1));

  const normalized = fillGapsWithIdle(input.segments, rangeStartMs, rangeEndMs);
  if (normalized.length <= maxSegments) return normalized;

  const totalMs = Math.max(1, rangeEndMs - rangeStartMs);
  const bucketMs = totalMs / maxSegments;
  const buckets: RecapTimelineSegment[] = [];

  for (let i = 0; i < maxSegments; i += 1) {
    const bucketStart = Math.trunc(rangeStartMs + i * bucketMs);
    const bucketEnd = i === maxSegments - 1 ? rangeEndMs : Math.trunc(rangeStartMs + (i + 1) * bucketMs);
    if (bucketEnd <= bucketStart) continue;

     let winner: RecapTimelineSegment | null = null;
     let winnerPriority = -1;
     let winnerOverlap = -1;

     for (const segment of normalized) {
       const overlapStart = Math.max(bucketStart, segment.startMs);
       const overlapEnd = Math.min(bucketEnd, segment.endMs);
       if (overlapEnd <= overlapStart) continue;

       const overlap = overlapEnd - overlapStart;
       const priority = segmentPriority(segment.type);

       if (priority > winnerPriority || (priority === winnerPriority && overlap > winnerOverlap)) {
         winner = segment;
         winnerPriority = priority;
         winnerOverlap = overlap;
       }
     }

    if (!winner) {
      buckets.push({
        type: "idle",
        startMs: bucketStart,
        endMs: bucketEnd,
        durationSec: Math.max(0, Math.trunc((bucketEnd - bucketStart) / 1000)),
        label: "Idle",
      });
      continue;
    }

    buckets.push(cloneForRange(winner, bucketStart, bucketEnd));
  }

  const merged = mergeNearbyEquivalentSegments(buckets, 0);
  return fillGapsWithIdle(merged, rangeStartMs, rangeEndMs);
}
