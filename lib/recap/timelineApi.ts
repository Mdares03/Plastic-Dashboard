import { prisma } from "@/lib/prisma";
import {
  buildTimelineSegments,
  compressTimelineSegments,
  TIMELINE_EVENT_TYPES,
  type TimelineCycleRow,
  type TimelineEventRow,
} from "@/lib/recap/timeline";
import type { RecapTimelineResponse } from "@/lib/recap/types";

const TIMELINE_EVENT_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const TIMELINE_CYCLE_LOOKBACK_MS = 15 * 60 * 1000;
const DEFAULT_RANGE_MS = 24 * 60 * 60 * 1000;
const MIN_RANGE_MS = 60 * 1000;
const MAX_RANGE_MS = 72 * 60 * 60 * 1000;

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

function parseRangeDurationMs(raw: string | null) {
  if (!raw) return null;
  const normalized = raw.trim().toLowerCase();
  const match = /^(\d+)\s*([hm])$/.exec(normalized);
  if (!match) return null;

  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const unit = match[2];
  const durationMs = unit === "m" ? amount * 60_000 : amount * 60 * 60_000;
  return Math.max(MIN_RANGE_MS, Math.min(MAX_RANGE_MS, durationMs));
}

function parseHours(raw: string | null) {
  if (!raw) return null;
  const parsed = Math.trunc(Number(raw));
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.max(1, Math.min(72, parsed));
}

function parseMaxSegments(searchParams: URLSearchParams) {
  const compact = searchParams.get("compact");
  const maxSegmentsRaw = searchParams.get("maxSegments");
  if (compact !== "1" && compact !== "true" && !maxSegmentsRaw) return null;

  const parsed = Math.trunc(Number(maxSegmentsRaw ?? "30"));
  if (!Number.isFinite(parsed) || parsed <= 0) return 30;
  return Math.max(5, Math.min(120, parsed));
}

export function parseRecapTimelineRange(searchParams: URLSearchParams) {
  const defaultEnd = new Date(Math.floor(Date.now() / 60000) * 60000);
  const end = parseDateInput(searchParams.get("end")) ?? defaultEnd;
  const startParam = parseDateInput(searchParams.get("start"));
  if (startParam && startParam < end) {
    return {
      start: startParam,
      end,
      maxSegments: parseMaxSegments(searchParams),
    };
  }

  const rangeDurationMs =
    parseRangeDurationMs(searchParams.get("range")) ??
    (() => {
      const hours = parseHours(searchParams.get("hours"));
      return hours ? hours * 60 * 60 * 1000 : null;
    })() ??
    DEFAULT_RANGE_MS;

  const start = new Date(end.getTime() - Math.max(MIN_RANGE_MS, Math.min(MAX_RANGE_MS, rangeDurationMs)));
  return {
    start,
    end,
    maxSegments: parseMaxSegments(searchParams),
  };
}

export async function getRecapTimelineForMachine(params: {
  orgId: string;
  machineId: string;
  start: Date;
  end: Date;
  maxSegments?: number | null;
}) {
  const [cyclesRaw, eventsRaw, cycleCount, eventCount] = await Promise.all([
    prisma.machineCycle.findMany({
      where: {
        orgId: params.orgId,
        machineId: params.machineId,
        ts: {
          gte: new Date(params.start.getTime() - TIMELINE_CYCLE_LOOKBACK_MS),
          lte: params.end,
        },
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
        orgId: params.orgId,
        machineId: params.machineId,
        eventType: { in: TIMELINE_EVENT_TYPES as unknown as string[] },
        ts: {
          gte: new Date(params.start.getTime() - TIMELINE_EVENT_LOOKBACK_MS),
          lte: params.end,
        },
      },
      orderBy: { ts: "asc" },
      select: {
        ts: true,
        eventType: true,
        data: true,
      },
    }),
    prisma.machineCycle.count({
      where: {
        orgId: params.orgId,
        machineId: params.machineId,
        ts: {
          gte: new Date(params.start.getTime() - TIMELINE_CYCLE_LOOKBACK_MS),
          lte: params.end,
        },
      },
    }),
    prisma.machineEvent.count({
      where: {
        orgId: params.orgId,
        machineId: params.machineId,
        ts: { gte: params.start, lte: params.end },
      },
    }),
  ]);

  const hasData = cycleCount > 0 || eventCount > 0;

  const cycles: TimelineCycleRow[] = cyclesRaw.map((row) => ({
    ts: row.ts,
    cycleCount: row.cycleCount,
    actualCycleTime: row.actualCycleTime,
    workOrderId: row.workOrderId,
    sku: row.sku,
  }));

  const events: TimelineEventRow[] = eventsRaw.map((row) => ({
    ts: row.ts,
    eventType: row.eventType,
    data: row.data,
  }));

  let segments = hasData
    ? buildTimelineSegments({
        cycles,
        events,
        rangeStart: params.start,
        rangeEnd: params.end,
      })
    : [];

  if (hasData && params.maxSegments && params.maxSegments > 0) {
    segments = compressTimelineSegments({
      segments,
      rangeStart: params.start,
      rangeEnd: params.end,
      maxSegments: params.maxSegments,
    });
  }

  const response: RecapTimelineResponse = {
    range: {
      start: params.start.toISOString(),
      end: params.end.toISOString(),
    },
    segments,
    hasData,
    generatedAt: new Date().toISOString(),
  };

  return response;
}
