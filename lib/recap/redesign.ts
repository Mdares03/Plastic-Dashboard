import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";
import { normalizeShiftOverrides, type ShiftOverrideDay } from "@/lib/settings";
import { getRecapDataCached } from "@/lib/recap/getRecapData";
import {
  buildTimelineSegments,
  compressTimelineSegments,
  TIMELINE_EVENT_TYPES,
  type TimelineCycleRow,
  type TimelineEventRow,
} from "@/lib/recap/timeline";
import type {
  RecapDetailResponse,
  RecapMachine,
  RecapMachineDetail,
  RecapMachineStatus,
  RecapRangeMode,
  RecapSummaryMachine,
  RecapSummaryResponse,
} from "@/lib/recap/types";

type DetailRangeInput = {
  mode?: string | null;
  start?: string | null;
  end?: string | null;
};

const OFFLINE_THRESHOLD_MS = 10 * 60 * 1000;
const TIMELINE_EVENT_LOOKBACK_MS = 24 * 60 * 60 * 1000;
const RECAP_CACHE_TTL_SEC = 60;
const WEEKDAY_KEYS: ShiftOverrideDay[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const WEEKDAY_KEY_MAP: Record<string, ShiftOverrideDay> = {
  Mon: "mon",
  Tue: "tue",
  Wed: "wed",
  Thu: "thu",
  Fri: "fri",
  Sat: "sat",
  Sun: "sun",
};

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function parseDate(input?: string | null) {
  if (!input) return null;
  const n = Number(input);
  if (Number.isFinite(n)) {
    const d = new Date(n);
    return Number.isFinite(d.getTime()) ? d : null;
  }
  const d = new Date(input);
  return Number.isFinite(d.getTime()) ? d : null;
}

function parseHours(input: string | null) {
  const parsed = Math.trunc(Number(input ?? "24"));
  if (!Number.isFinite(parsed)) return 24;
  return Math.max(1, Math.min(72, parsed));
}

function parseTimeMinutes(input?: string | null) {
  if (!input) return null;
  const match = /^(\d{2}):(\d{2})$/.exec(input.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }
  return hours * 60 + minutes;
}

function getLocalParts(ts: Date, timeZone: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      weekday: "short",
      hour12: false,
    }).formatToParts(ts);

    const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
    const year = Number(value("year"));
    const month = Number(value("month"));
    const day = Number(value("day"));
    const hour = Number(value("hour"));
    const minute = Number(value("minute"));
    const weekday = value("weekday");

    return {
      year,
      month,
      day,
      hour,
      minute,
      weekday: WEEKDAY_KEY_MAP[weekday] ?? WEEKDAY_KEYS[ts.getUTCDay()],
      minutesOfDay: hour * 60 + minute,
    };
  } catch {
    return {
      year: ts.getUTCFullYear(),
      month: ts.getUTCMonth() + 1,
      day: ts.getUTCDate(),
      hour: ts.getUTCHours(),
      minute: ts.getUTCMinutes(),
      weekday: WEEKDAY_KEYS[ts.getUTCDay()],
      minutesOfDay: ts.getUTCHours() * 60 + ts.getUTCMinutes(),
    };
  }
}

function parseOffsetMinutes(offsetLabel: string | null) {
  if (!offsetLabel) return null;
  const normalized = offsetLabel.replace("UTC", "GMT");
  const match = /^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/.exec(normalized);
  if (!match) return null;
  const sign = match[1] === "-" ? -1 : 1;
  const hour = Number(match[2]);
  const minute = Number(match[3] ?? "0");
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return sign * (hour * 60 + minute);
}

function getTzOffsetMinutes(utcDate: Date, timeZone: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "shortOffset",
      hour: "2-digit",
    }).formatToParts(utcDate);
    const offsetPart = parts.find((part) => part.type === "timeZoneName")?.value ?? null;
    return parseOffsetMinutes(offsetPart);
  } catch {
    return null;
  }
}

function zonedToUtcDate(input: {
  year: number;
  month: number;
  day: number;
  hours: number;
  minutes: number;
  timeZone: string;
}) {
  const baseUtc = Date.UTC(input.year, input.month - 1, input.day, input.hours, input.minutes, 0, 0);
  const guessDate = new Date(baseUtc);
  const offsetA = getTzOffsetMinutes(guessDate, input.timeZone);
  if (offsetA == null) return guessDate;

  let corrected = new Date(baseUtc - offsetA * 60000);
  const offsetB = getTzOffsetMinutes(corrected, input.timeZone);
  if (offsetB != null && offsetB !== offsetA) {
    corrected = new Date(baseUtc - offsetB * 60000);
  }

  return corrected;
}

function addDays(input: { year: number; month: number; day: number }, days: number) {
  const base = new Date(Date.UTC(input.year, input.month - 1, input.day));
  base.setUTCDate(base.getUTCDate() + days);
  return {
    year: base.getUTCFullYear(),
    month: base.getUTCMonth() + 1,
    day: base.getUTCDate(),
  };
}

function statusFromMachine(machine: RecapMachine, endMs: number) {
  const lastSeenMs = machine.heartbeat.lastSeenAt ? new Date(machine.heartbeat.lastSeenAt).getTime() : null;
  const offlineForMs = lastSeenMs == null ? Number.POSITIVE_INFINITY : Math.max(0, endMs - lastSeenMs);
  const offline = !Number.isFinite(lastSeenMs ?? Number.NaN) || offlineForMs > OFFLINE_THRESHOLD_MS;

  const ongoingStopMin = machine.downtime.ongoingStopMin ?? 0;
  const moldActive = machine.workOrders.moldChangeInProgress;

  let status: RecapMachineStatus = "running";
  if (offline) status = "offline";
  else if (moldActive) status = "mold-change";
  else if (ongoingStopMin > 0) status = "stopped";

  return {
    status,
    lastSeenMs,
    offlineForMin: offline ? Math.max(0, Math.floor(offlineForMs / 60000)) : null,
    ongoingStopMin: machine.downtime.ongoingStopMin,
  };
}

async function loadTimelineRowsForMachines(params: {
  orgId: string;
  machineIds: string[];
  start: Date;
  end: Date;
}) {
  if (!params.machineIds.length) {
    return {
      cyclesByMachine: new Map<string, TimelineCycleRow[]>(),
      eventsByMachine: new Map<string, TimelineEventRow[]>(),
    };
  }

  const [cycles, events] = await Promise.all([
    prisma.machineCycle.findMany({
      where: {
        orgId: params.orgId,
        machineId: { in: params.machineIds },
        ts: { gte: params.start, lte: params.end },
      },
      orderBy: [{ machineId: "asc" }, { ts: "asc" }],
      select: {
        machineId: true,
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
        machineId: { in: params.machineIds },
        eventType: { in: TIMELINE_EVENT_TYPES as unknown as string[] },
        ts: {
          gte: new Date(params.start.getTime() - TIMELINE_EVENT_LOOKBACK_MS),
          lte: params.end,
        },
      },
      orderBy: [{ machineId: "asc" }, { ts: "asc" }],
      select: {
        machineId: true,
        ts: true,
        eventType: true,
        data: true,
      },
    }),
  ]);

  const cyclesByMachine = new Map<string, TimelineCycleRow[]>();
  const eventsByMachine = new Map<string, TimelineEventRow[]>();

  for (const row of cycles) {
    const list = cyclesByMachine.get(row.machineId) ?? [];
    list.push({
      ts: row.ts,
      cycleCount: row.cycleCount,
      actualCycleTime: row.actualCycleTime,
      workOrderId: row.workOrderId,
      sku: row.sku,
    });
    cyclesByMachine.set(row.machineId, list);
  }

  for (const row of events) {
    const list = eventsByMachine.get(row.machineId) ?? [];
    list.push({
      ts: row.ts,
      eventType: row.eventType,
      data: row.data,
    });
    eventsByMachine.set(row.machineId, list);
  }

  return { cyclesByMachine, eventsByMachine };
}

function toSummaryMachine(params: {
  machine: RecapMachine;
  miniTimeline: ReturnType<typeof compressTimelineSegments>;
  rangeEndMs: number;
}): RecapSummaryMachine {
  const { machine, miniTimeline, rangeEndMs } = params;
  const status = statusFromMachine(machine, rangeEndMs);

  return {
    machineId: machine.machineId,
    name: machine.machineName,
    location: machine.location,
    status: status.status,
    oee: machine.oee.avg,
    goodParts: machine.production.goodParts,
    scrap: machine.production.scrapParts,
    stopsCount: machine.downtime.stopsCount,
    lastSeenMs: status.lastSeenMs,
    lastActivityMin:
      status.lastSeenMs == null ? null : Math.max(0, Math.floor((rangeEndMs - status.lastSeenMs) / 60000)),
    offlineForMin: status.offlineForMin,
    ongoingStopMin: status.ongoingStopMin,
    activeWorkOrderId: machine.workOrders.active?.id ?? null,
    moldChange: {
      active: machine.workOrders.moldChangeInProgress,
      startMs: machine.workOrders.moldChangeStartMs,
      elapsedMin:
        machine.workOrders.moldChangeStartMs == null
          ? null
          : Math.max(0, Math.floor((rangeEndMs - machine.workOrders.moldChangeStartMs) / 60000)),
    },
    miniTimeline,
  };
}

async function computeRecapSummary(params: { orgId: string; hours: number }) {
  const now = new Date();
  const end = new Date(Math.floor(now.getTime() / 60000) * 60000);
  const start = new Date(end.getTime() - params.hours * 60 * 60 * 1000);

  const recap = await getRecapDataCached({
    orgId: params.orgId,
    start,
    end,
  });

  const machineIds = recap.machines.map((machine) => machine.machineId);
  const timelineRows = await loadTimelineRowsForMachines({
    orgId: params.orgId,
    machineIds,
    start,
    end,
  });

  const machines = recap.machines.map((machine) => {
    const segments = buildTimelineSegments({
      cycles: timelineRows.cyclesByMachine.get(machine.machineId) ?? [],
      events: timelineRows.eventsByMachine.get(machine.machineId) ?? [],
      rangeStart: start,
      rangeEnd: end,
    });
    const miniTimeline = compressTimelineSegments({
      segments,
      rangeStart: start,
      rangeEnd: end,
      maxSegments: 30,
    });

    return toSummaryMachine({
      machine,
      miniTimeline,
      rangeEndMs: end.getTime(),
    });
  });

  const response: RecapSummaryResponse = {
    generatedAt: new Date().toISOString(),
    range: {
      start: start.toISOString(),
      end: end.toISOString(),
      hours: params.hours,
    },
    machines,
  };

  return response;
}

function normalizedRangeMode(mode?: string | null): RecapRangeMode {
  const raw = String(mode ?? "").trim().toLowerCase();
  if (raw === "shift") return "shift";
  if (raw === "yesterday") return "yesterday";
  if (raw === "custom") return "custom";
  return "24h";
}

async function resolveCurrentShiftRange(params: { orgId: string; now: Date }) {
  const settings = await prisma.orgSettings.findUnique({
    where: { orgId: params.orgId },
    select: {
      timezone: true,
      shiftScheduleOverridesJson: true,
    },
  });
  const shifts = await prisma.orgShift.findMany({
    where: { orgId: params.orgId },
    orderBy: { sortOrder: "asc" },
    select: {
      name: true,
      startTime: true,
      endTime: true,
      enabled: true,
      sortOrder: true,
    },
  });

  const enabledShifts = shifts.filter((shift) => shift.enabled !== false);
  if (!enabledShifts.length) {
    return {
      hasEnabledShifts: false,
      range: null,
    } as const;
  }

  const timeZone = settings?.timezone || "UTC";
  const local = getLocalParts(params.now, timeZone);
  const overrides = normalizeShiftOverrides(settings?.shiftScheduleOverridesJson);
  const dayOverrides = overrides?.[local.weekday];
  const activeShifts = (dayOverrides?.length
    ? dayOverrides.map((shift) => ({
        enabled: shift.enabled !== false,
        start: shift.start,
        end: shift.end,
      }))
    : enabledShifts.map((shift) => ({
        enabled: shift.enabled !== false,
        start: shift.startTime,
        end: shift.endTime,
      }))
  ).filter((shift) => shift.enabled);

  for (const shift of activeShifts) {
    const startMin = parseTimeMinutes(shift.start ?? null);
    const endMin = parseTimeMinutes(shift.end ?? null);
    if (startMin == null || endMin == null) continue;

    const minutesNow = local.minutesOfDay;
    let inRange = false;
    let startDate = { year: local.year, month: local.month, day: local.day };
    let endDate = { year: local.year, month: local.month, day: local.day };

    if (startMin <= endMin) {
      inRange = minutesNow >= startMin && minutesNow < endMin;
    } else {
      inRange = minutesNow >= startMin || minutesNow < endMin;
      if (minutesNow >= startMin) {
        endDate = addDays(endDate, 1);
      } else {
        startDate = addDays(startDate, -1);
      }
    }

    if (!inRange) continue;

    const start = zonedToUtcDate({
      ...startDate,
      hours: Math.floor(startMin / 60),
      minutes: startMin % 60,
      timeZone,
    });
    const end = zonedToUtcDate({
      ...endDate,
      hours: Math.floor(endMin / 60),
      minutes: endMin % 60,
      timeZone,
    });

    if (end <= start) continue;

    return {
      hasEnabledShifts: true,
      range: {
        start,
        end,
      },
    };
  }

  return {
    hasEnabledShifts: true,
    range: null,
  } as const;
}

async function resolveDetailRange(params: { orgId: string; input: DetailRangeInput }) {
  const now = new Date();
  const requestedMode = normalizedRangeMode(params.input.mode);
  const shiftEnabledCount = await prisma.orgShift.count({
    where: {
      orgId: params.orgId,
      enabled: { not: false },
    },
  });
  const shiftAvailable = shiftEnabledCount > 0;

  if (requestedMode === "custom") {
    const start = parseDate(params.input.start);
    const end = parseDate(params.input.end);
    if (start && end && end > start) {
      return {
        requestedMode,
        mode: requestedMode,
        start,
        end,
        shiftAvailable,
      } as const;
    }
  }

  if (requestedMode === "yesterday") {
    const settings = await prisma.orgSettings.findUnique({
      where: { orgId: params.orgId },
      select: { timezone: true },
    });
    const timeZone = settings?.timezone || "America/Mexico_City";
    const localNow = getLocalParts(now, timeZone);
    const today = { year: localNow.year, month: localNow.month, day: localNow.day };
    const yesterday = addDays(today, -1);
    const start = zonedToUtcDate({
      ...yesterday,
      hours: 0,
      minutes: 0,
      timeZone,
    });
    const end = zonedToUtcDate({
      ...today,
      hours: 0,
      minutes: 0,
      timeZone,
    });
    return {
      requestedMode,
      mode: requestedMode,
      start,
      end,
      shiftAvailable,
    } as const;
  }

  if (requestedMode === "shift") {
    const shiftRange = await resolveCurrentShiftRange({ orgId: params.orgId, now });
    if (shiftRange.range) {
      return {
        requestedMode,
        mode: requestedMode,
        start: shiftRange.range.start,
        end: shiftRange.range.end,
        shiftAvailable,
      } as const;
    }
    if (!shiftRange.hasEnabledShifts) {
      return {
        requestedMode,
        mode: "24h" as const,
        start: new Date(now.getTime() - 24 * 60 * 60 * 1000),
        end: now,
        shiftAvailable,
        fallbackReason: "shift-unavailable" as const,
      } as const;
    }
    return {
      requestedMode,
      mode: "24h" as const,
      start: new Date(now.getTime() - 24 * 60 * 60 * 1000),
      end: now,
      shiftAvailable,
      fallbackReason: "shift-inactive" as const,
    } as const;
  }

  return {
    requestedMode,
    mode: "24h" as const,
    start: new Date(now.getTime() - 24 * 60 * 60 * 1000),
    end: now,
    shiftAvailable,
  } as const;
}

async function computeRecapMachineDetail(params: {
  orgId: string;
  machineId: string;
  range: {
    requestedMode: RecapRangeMode;
    mode: RecapRangeMode;
    start: Date;
    end: Date;
    shiftAvailable: boolean;
    fallbackReason?: "shift-unavailable" | "shift-inactive";
  };
}) {
  const { range } = params;

  const recap = await getRecapDataCached({
    orgId: params.orgId,
    machineId: params.machineId,
    start: range.start,
    end: range.end,
  });

  const machine = recap.machines.find((row) => row.machineId === params.machineId) ?? null;
  if (!machine) return null;

  const timelineRows = await loadTimelineRowsForMachines({
    orgId: params.orgId,
    machineIds: [params.machineId],
    start: range.start,
    end: range.end,
  });

  const timeline = buildTimelineSegments({
    cycles: timelineRows.cyclesByMachine.get(params.machineId) ?? [],
    events: timelineRows.eventsByMachine.get(params.machineId) ?? [],
    rangeStart: range.start,
    rangeEnd: range.end,
  });

  const status = statusFromMachine(machine, range.end.getTime());

  const downtimeTotalMin = Math.max(0, machine.downtime.totalMin);
  const downtimeTop = machine.downtime.topReasons.slice(0, 3).map((row) => ({
    reasonLabel: row.reasonLabel,
    minutes: row.minutes,
    count: row.count,
    percent: downtimeTotalMin > 0 ? round2((row.minutes / downtimeTotalMin) * 100) : 0,
  }));

  const machineDetail: RecapMachineDetail = {
    machineId: machine.machineId,
    name: machine.machineName,
    location: machine.location,
    status: status.status,
    oee: machine.oee.avg,
    goodParts: machine.production.goodParts,
    scrap: machine.production.scrapParts,
    stopsCount: machine.downtime.stopsCount,
    stopMinutes: downtimeTotalMin,
    activeWorkOrderId: machine.workOrders.active?.id ?? null,
    lastSeenMs: status.lastSeenMs,
    offlineForMin: status.offlineForMin,
    ongoingStopMin: status.ongoingStopMin,
    moldChange: {
      active: machine.workOrders.moldChangeInProgress,
      startMs: machine.workOrders.moldChangeStartMs,
    },
    timeline,
    productionBySku: machine.production.bySku,
    downtimeTop,
    workOrders: {
      completed: machine.workOrders.completed,
      active: machine.workOrders.active,
    },
    heartbeat: {
      lastSeenAt: machine.heartbeat.lastSeenAt,
      uptimePct: machine.heartbeat.uptimePct,
      connectionStatus: status.status === "offline" ? "offline" : "online",
    },
  };

  const response: RecapDetailResponse = {
    generatedAt: new Date().toISOString(),
    range: {
      requestedMode: range.requestedMode,
      mode: range.mode,
      start: range.start.toISOString(),
      end: range.end.toISOString(),
      shiftAvailable: range.shiftAvailable,
      fallbackReason: range.fallbackReason,
    },
    machine: machineDetail,
  };

  return response;
}

function summaryCacheKey(params: { orgId: string; hours: number }) {
  return ["recap-summary-v1", params.orgId, String(params.hours)];
}

function detailCacheKey(params: {
  orgId: string;
  machineId: string;
  requestedMode: RecapRangeMode;
  mode: RecapRangeMode;
  shiftAvailable: boolean;
  fallbackReason?: "shift-unavailable" | "shift-inactive";
  startMs: number;
  endMs: number;
}) {
  return [
    "recap-detail-v1",
    params.orgId,
    params.machineId,
    params.requestedMode,
    params.mode,
    params.shiftAvailable ? "shift-on" : "shift-off",
    params.fallbackReason ?? "",
    String(Math.trunc(params.startMs / 60000)),
    String(Math.trunc(params.endMs / 60000)),
  ];
}

export function parseRecapSummaryHours(raw: string | null) {
  return parseHours(raw);
}

export function parseRecapDetailRangeInput(searchParams: URLSearchParams | Record<string, string | string[] | undefined>) {
  if (searchParams instanceof URLSearchParams) {
    return {
      mode: searchParams.get("range") ?? undefined,
      start: searchParams.get("start") ?? undefined,
      end: searchParams.get("end") ?? undefined,
    };
  }

  const pick = (key: string) => {
    const value = searchParams[key];
    if (Array.isArray(value)) return value[0] ?? undefined;
    return value ?? undefined;
  };

  return {
    mode: pick("range"),
    start: pick("start"),
    end: pick("end"),
  };
}

export async function getRecapSummaryCached(params: { orgId: string; hours: number }) {
  const cache = unstable_cache(
    () => computeRecapSummary(params),
    summaryCacheKey(params),
    {
      revalidate: RECAP_CACHE_TTL_SEC,
      tags: [`recap:${params.orgId}`],
    }
  );

  return cache();
}

export async function getRecapMachineDetailCached(params: {
  orgId: string;
  machineId: string;
  input: DetailRangeInput;
}) {
  const resolved = await resolveDetailRange({
    orgId: params.orgId,
    input: params.input,
  });

  const cache = unstable_cache(
    () =>
      computeRecapMachineDetail({
        orgId: params.orgId,
        machineId: params.machineId,
        range: {
          requestedMode: resolved.requestedMode,
          mode: resolved.mode,
          start: resolved.start,
          end: resolved.end,
          shiftAvailable: resolved.shiftAvailable,
          fallbackReason: resolved.fallbackReason,
        },
      }),
    detailCacheKey({
      orgId: params.orgId,
      machineId: params.machineId,
      requestedMode: resolved.requestedMode,
      mode: resolved.mode,
      shiftAvailable: resolved.shiftAvailable,
      fallbackReason: resolved.fallbackReason,
      startMs: resolved.start.getTime(),
      endMs: resolved.end.getTime(),
    }),
    {
      revalidate: RECAP_CACHE_TTL_SEC,
      tags: [`recap:${params.orgId}`, `recap:${params.orgId}:${params.machineId}`],
    }
  );

  return cache();
}
