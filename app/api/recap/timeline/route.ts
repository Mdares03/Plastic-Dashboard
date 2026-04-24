import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { requireSession } from "@/lib/auth/requireSession";
import { prisma } from "@/lib/prisma";
import type { RecapTimelineResponse, RecapTimelineSegment } from "@/lib/recap/types";

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

const EVENT_TYPES = ["mold-change", "macrostop", "microstop", "slow-cycle"] as const;
type TimelineEventType = (typeof EVENT_TYPES)[number];
const ACTIVE_STALE_MS = 2 * 60 * 1000;
const PRIORITY: Record<string, number> = {
  idle: 0,
  production: 1,
  microstop: 2,
  "slow-cycle": 2,
  macrostop: 3,
  "mold-change": 4,
};

function bad(status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status });
}

function safeNum(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
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

function parseHours(raw: string | null) {
  const value = Math.trunc(Number(raw || "24"));
  if (!Number.isFinite(value)) return 24;
  return Math.max(1, Math.min(72, value));
}

function parseDateInput(raw: string | null) {
  if (!raw) return null;
  const asNum = Number(raw);
  if (Number.isFinite(asNum)) {
    const d = new Date(asNum);
    return Number.isFinite(d.getTime()) ? d : null;
  }
  const d = new Date(raw);
  return Number.isFinite(d.getTime()) ? d : null;
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
  const record = typeof parsed === "object" && parsed && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  const nested = record.data;
  if (typeof nested === "object" && nested && !Array.isArray(nested)) return nested as Record<string, unknown>;
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
      String(rec.detailLabel ?? rec.detail_label ?? rec.detailId ?? rec.detail_id ?? "").trim() || null;
    const category =
      String(rec.categoryLabel ?? rec.category_label ?? rec.categoryId ?? rec.category_id ?? "").trim() || null;
    if (category && detail) return `${category} > ${detail}`;
    if (detail) return detail;
    if (category) return category;
  }
  return null;
}

function labelForStop(type: "macrostop" | "microstop" | "slow-cycle", reason: string | null) {
  if (type === "macrostop") return reason ? `Paro: ${reason}` : "Paro";
  if (type === "microstop") return reason ? `Microparo: ${reason}` : "Microparo";
  return "Ciclo lento";
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

export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!session) return bad(401, "Unauthorized");

  const url = new URL(req.url);
  const machineId = url.searchParams.get("machineId");
  if (!machineId) return bad(400, "machineId is required");
  const hours = parseHours(url.searchParams.get("hours"));
  const startParam = parseDateInput(url.searchParams.get("start"));
  const endParam = parseDateInput(url.searchParams.get("end"));

  const machine = await prisma.machine.findFirst({
    where: { id: machineId, orgId: session.orgId },
    select: { id: true },
  });
  if (!machine) return bad(404, "Machine not found");

  const end = endParam ?? new Date();
  const start = startParam && startParam < end ? startParam : new Date(end.getTime() - hours * 60 * 60 * 1000);
  const rangeStartMs = start.getTime();
  const rangeEndMs = end.getTime();

  const [cycles, events] = await Promise.all([
    prisma.machineCycle.findMany({
      where: {
        orgId: session.orgId,
        machineId,
        ts: { gte: start, lte: end },
      },
      orderBy: { ts: "asc" },
      select: {
        ts: true,
        cycleCount: true,
        actualCycleTime: true,
        workOrderId: true,
        sku: true,
      },
    }),
    prisma.machineEvent.findMany({
      where: {
        orgId: session.orgId,
        machineId,
        eventType: { in: EVENT_TYPES as unknown as string[] },
        ts: { gte: new Date(start.getTime() - 24 * 60 * 60 * 1000), lte: end },
      },
      orderBy: { ts: "asc" },
      select: {
        ts: true,
        eventType: true,
        data: true,
      },
    }),
  ]);

  const dedupedCycles = dedupeByKey(
    cycles,
    (cycle) =>
      `${cycle.ts.getTime()}:${safeNum(cycle.cycleCount) ?? "na"}:${normalizeToken(cycle.workOrderId).toUpperCase()}:${normalizeToken(cycle.sku).toUpperCase()}:${safeNum(cycle.actualCycleTime) ?? "na"}`
  );

  const rawSegments: RawSegment[] = [];

  let currentProduction: RawSegment | null = null;
  for (const cycle of dedupedCycles) {
    if (!cycle.workOrderId) continue;
    const cycleStartMs = cycle.ts.getTime();
    const cycleDurationMs = Math.max(1000, Math.min(600000, Math.trunc((safeNum(cycle.actualCycleTime) ?? 1) * 1000)));
    const cycleEndMs = cycleStartMs + cycleDurationMs;

    if (
      currentProduction &&
      currentProduction.type === "production" &&
      currentProduction.workOrderId === cycle.workOrderId &&
      currentProduction.sku === cycle.sku &&
      cycleStartMs <= currentProduction.endMs + 5 * 60 * 1000
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

  const eventEpisodes = new Map<
    string,
    {
      type: "mold-change" | "macrostop" | "microstop" | "slow-cycle";
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

  for (const event of events) {
    const eventType = String(event.eventType || "").toLowerCase() as TimelineEventType;
    if (!EVENT_TYPES.includes(eventType)) continue;

    const data = extractData(event.data);
    const tsMs = event.ts.getTime();
    const key = eventIncidentKey(eventType, data, tsMs);
    const status = String(data.status ?? "").trim().toLowerCase();

    const episode = eventEpisodes.get(key) ?? {
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
    episode.firstTsMs = Math.min(episode.firstTsMs, tsMs);
    episode.lastTsMs = Math.max(episode.lastTsMs, tsMs);

    const startMs = safeNum(data.start_ms) ?? safeNum(data.startMs);
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
    const startMs = Math.trunc(episode.startMs ?? episode.firstTsMs);
    let endMs = Math.trunc(episode.endMs ?? episode.lastTsMs);
    if (episode.statusActive && !episode.statusResolved) {
      const isFreshActive = rangeEndMs - episode.lastTsMs <= ACTIVE_STALE_MS;
      endMs = isFreshActive ? rangeEndMs : episode.lastTsMs;
    } else if (endMs <= startMs && episode.durationSec != null && episode.durationSec > 0) {
      endMs = startMs + episode.durationSec * 1000;
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

    const stopType = episode.type;
    rawSegments.push({
      type: stopType,
      startMs,
      endMs,
      priority: PRIORITY[stopType],
      reason: episode.reason,
      durationSec: Math.max(0, Math.trunc((endMs - startMs) / 1000)),
      label: labelForStop(stopType, episode.reason),
    });
  }

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
    if (!winner) {
      timeline.push({ type: "idle", startMs: intervalStart, endMs: intervalEnd, label: "Idle" });
      continue;
    }

    if (winner.type === "production") {
      timeline.push({
        type: "production",
        startMs: intervalStart,
        endMs: intervalEnd,
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

    timeline.push({
      type: winner.type,
      startMs: intervalStart,
      endMs: intervalEnd,
      reason: winner.reason,
      durationSec: Math.max(0, Math.trunc((intervalEnd - intervalStart) / 1000)),
      label: winner.label,
    });
  }

  const merged: RecapTimelineSegment[] = [];
  for (const segment of timeline) {
    const prev = merged[merged.length - 1];
    if (!prev || !isEquivalent(prev, segment) || prev.endMs !== segment.startMs) {
      merged.push(segment);
      continue;
    }
    prev.endMs = segment.endMs;
    if (prev.type === "mold-change") prev.durationSec = Math.max(0, Math.trunc((prev.endMs - prev.startMs) / 1000));
    if (prev.type === "macrostop" || prev.type === "microstop" || prev.type === "slow-cycle") {
      prev.durationSec = Math.max(0, Math.trunc((prev.endMs - prev.startMs) / 1000));
    }
  }

  const response: RecapTimelineResponse = {
    range: {
      start: start.toISOString(),
      end: end.toISOString(),
    },
    segments: merged,
  };

  return NextResponse.json(response);
}
