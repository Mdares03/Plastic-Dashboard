import { normalizeShiftOverrides } from "@/lib/settings";
import { prisma } from "@/lib/prisma";

const RANGE_MS: Record<string, number> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

type AlertsInboxParams = {
  orgId: string;
  range?: string;
  start?: Date | null;
  end?: Date | null;
  machineId?: string;
  location?: string;
  eventType?: string;
  severity?: string;
  status?: string;
  shift?: string;
  includeUpdates?: boolean;
  limit?: number;
};

type AlertsInboxEvent = {
  id: string;
  ts: Date;
  eventType: string;
  severity: string;
  title: string;
  description?: string | null;
  machineId: string;
  machineName?: string | null;
  location?: string | null;
  workOrderId?: string | null;
  sku?: string | null;
  durationSec?: number | null;
  status?: string | null;
  shift?: string | null;
  alertId?: string | null;
  isUpdate?: boolean;
  isAutoAck?: boolean;
};

function pickRange(range: string, start?: Date | null, end?: Date | null) {
  const now = new Date();
  if (range === "custom") {
    const startFallback = new Date(now.getTime() - RANGE_MS["24h"]);
    return {
      range,
      start: start ?? startFallback,
      end: end ?? now,
    };
  }
  const ms = RANGE_MS[range] ?? RANGE_MS["24h"];
  return { range, start: new Date(now.getTime() - ms), end: now };
}

function safeString(value: unknown) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function safeNumber(value: unknown) {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function safeBool(value: unknown) {
  return value === true;
}

function normalizeStatus(value?: string | null) {
  if (!value) return null;
  const raw = value.trim().toLowerCase();
  if (!raw) return null;
  if (raw === "in_progress" || raw === "in-progress" || raw === "open" || raw === "activa" || raw === "activo") {
    return "active";
  }
  if (raw === "resuelta" || raw === "resuelto" || raw === "closed" || raw === "ended" || raw === "done") {
    return "resolved";
  }
  return raw;
}

function parsePayload(raw: unknown) {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = raw;
    }
  }
  const payload =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  const innerCandidate = payload.data;
  const inner =
    innerCandidate && typeof innerCandidate === "object" && !Array.isArray(innerCandidate)
      ? (innerCandidate as Record<string, unknown>)
      : payload;
  return { payload, inner };
}

function extractDurationSec(raw: unknown) {
  const { payload, inner } = parsePayload(raw);
  const candidates = [
    inner?.duration_seconds,
    inner?.duration_sec,
    inner?.stoppage_duration_seconds,
    inner?.stop_duration_seconds,
    payload?.duration_seconds,
    payload?.duration_sec,
    payload?.stoppage_duration_seconds,
    payload?.stop_duration_seconds,
  ];
  for (const val of candidates) {
    if (typeof val === "number" && Number.isFinite(val) && val >= 0) return val;
  }
  const msCandidates = [inner?.duration_ms, inner?.durationMs, payload?.duration_ms, payload?.durationMs];
  for (const val of msCandidates) {
    if (typeof val === "number" && Number.isFinite(val) && val >= 0) {
      return Math.round(val / 1000);
    }
  }

  const startMs = inner.start_ts ?? inner.startTs ?? payload.start_ts ?? payload.startTs ?? null;
  const endMs = inner.end_ts ?? inner.endTs ?? payload.end_ts ?? payload.endTs ?? null;
  if (typeof startMs === "number" && typeof endMs === "number" && endMs >= startMs) {
    return Math.round((endMs - startMs) / 1000);
  }

  const actual = safeNumber(inner.actual_cycle_time ?? payload.actual_cycle_time);
  const theoretical = safeNumber(inner.theoretical_cycle_time ?? payload.theoretical_cycle_time);
  if (actual != null && theoretical != null) {
    return Math.max(0, actual - theoretical);
  }

  return null;
}

function parseTimeMinutes(value?: string | null) {
  if (!value || !/^\d{2}:\d{2}$/.test(value)) return null;
  const [hh, mm] = value.split(":").map((n) => Number(n));
  if (!Number.isFinite(hh) || !Number.isFinite(mm)) return null;
  return hh * 60 + mm;
}

function getLocalMinutes(ts: Date, timeZone: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(ts);
    const hours = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
    const minutes = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
    return hours * 60 + minutes;
  } catch {
    return ts.getUTCHours() * 60 + ts.getUTCMinutes();
  }
}

const WEEKDAY_KEY_MAP: Record<string, string> = {
  Sun: "sun",
  Mon: "mon",
  Tue: "tue",
  Wed: "wed",
  Thu: "thu",
  Fri: "fri",
  Sat: "sat",
};

const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;

function getLocalDayKey(ts: Date, timeZone: string) {
  try {
    const weekday = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
    }).format(ts);
    return WEEKDAY_KEY_MAP[weekday] ?? WEEKDAY_KEYS[ts.getUTCDay()];
  } catch {
    return WEEKDAY_KEYS[ts.getUTCDay()];
  }
}

type ShiftLike = {
  name: string;
  startTime?: string | null;
  endTime?: string | null;
  start?: string | null;
  end?: string | null;
  enabled?: boolean;
};

function resolveShift(
  shifts: ShiftLike[],
  overrides: Record<string, ShiftLike[]> | undefined,
  ts: Date,
  timeZone: string
) {
  const dayKey = getLocalDayKey(ts, timeZone);
  const dayOverrides = overrides?.[dayKey];
  const activeShifts = dayOverrides ?? shifts;
  if (!activeShifts.length) return null;
  const nowMin = getLocalMinutes(ts, timeZone);
  for (const shift of activeShifts) {
    if (shift.enabled === false) continue;
    const start = parseTimeMinutes(shift.startTime ?? shift.start ?? null);
    const end = parseTimeMinutes(shift.endTime ?? shift.end ?? null);
    if (start == null || end == null) continue;
    if (start <= end) {
      if (nowMin >= start && nowMin < end) return shift.name;
    } else {
      if (nowMin >= start || nowMin < end) return shift.name;
    }
  }
  return null;
}

function collapseAlertEvents(events: AlertsInboxEvent[]) {
  const byAlert = new Map<string, AlertsInboxEvent>();
  const passthrough: AlertsInboxEvent[] = [];

  for (const ev of events) {
    if (!ev.alertId) {
      passthrough.push(ev);
      continue;
    }
    const statusKey = ev.status === "resolved" ? "resolved" : "active";
    const key = `${ev.alertId}:${statusKey}`;
    const existing = byAlert.get(key);
    if (!existing) {
      byAlert.set(key, ev);
      continue;
    }
    const pickNewest = statusKey === "resolved";
    const shouldReplace = pickNewest
      ? ev.ts.getTime() > existing.ts.getTime()
      : ev.ts.getTime() < existing.ts.getTime();
    if (shouldReplace) byAlert.set(key, ev);
  }

  const combined = [...passthrough, ...byAlert.values()];
  combined.sort((a, b) => b.ts.getTime() - a.ts.getTime());
  return combined;
}

export async function getAlertsInboxData(params: AlertsInboxParams) {
  const {
    orgId,
    range = "24h",
    start,
    end,
    machineId,
    location,
    eventType,
    severity,
    status,
    shift,
    includeUpdates = false,
    limit = 200,
  } = params;

  const picked = pickRange(range, start, end);
  const normalizedStatus = safeString(status)?.toLowerCase();
  const normalizedShift = safeString(shift);
  const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(limit, 1), 500) : 200;

  const where = {
    orgId,
    ts: { gte: picked.start, lte: picked.end },
    ...(machineId ? { machineId } : {}),
    ...(eventType ? { eventType } : {}),
    ...(severity ? { severity } : {}),
    ...(location ? { machine: { location } } : {}),
  };

  const [events, shifts, settings] = await Promise.all([
    prisma.machineEvent.findMany({
      where,
      orderBy: { ts: "desc" },
      take: safeLimit,
      select: {
        id: true,
        ts: true,
        eventType: true,
        severity: true,
        title: true,
        description: true,
        data: true,
        machineId: true,
        workOrderId: true,
        sku: true,
        machine: {
          select: {
            name: true,
            location: true,
          },
        },
      },
    }),
    prisma.orgShift.findMany({
      where: { orgId },
      orderBy: { sortOrder: "asc" },
      select: { name: true, startTime: true, endTime: true, enabled: true },
    }),
    prisma.orgSettings.findUnique({
      where: { orgId },
      select: { timezone: true, shiftScheduleOverridesJson: true },
    }),
  ]);

  const timeZone = settings?.timezone || "UTC";
  const shiftOverrides = normalizeShiftOverrides(settings?.shiftScheduleOverridesJson);
  const mapped: AlertsInboxEvent[] = [];

  for (const ev of events) {
    const { payload, inner } = parsePayload(ev.data);
    const rawStatus = safeString(payload?.status ?? inner?.status);
    const isUpdate = safeBool(payload?.is_update ?? inner?.is_update);
    const isAutoAck = safeBool(payload?.is_auto_ack ?? inner?.is_auto_ack);
    if (!includeUpdates && (isUpdate || isAutoAck)) continue;

    const shiftName = resolveShift(shifts, shiftOverrides, ev.ts, timeZone);
    if (normalizedShift && shiftName !== normalizedShift) continue;

    const statusLabel = normalizeStatus(rawStatus) ?? "unknown";
    if (normalizedStatus && statusLabel !== normalizedStatus) continue;

    mapped.push({
      id: ev.id,
      ts: ev.ts,
      eventType: ev.eventType,
      severity: ev.severity,
      title: ev.title,
      description: ev.description,
      machineId: ev.machineId,
      machineName: ev.machine?.name ?? null,
      location: ev.machine?.location ?? null,
      workOrderId: ev.workOrderId ?? null,
      sku: ev.sku ?? null,
      durationSec: extractDurationSec(ev.data),
      status: statusLabel,
      shift: shiftName,
      alertId: safeString(payload?.alert_id ?? inner?.alert_id),
      isUpdate,
      isAutoAck,
    });
  }

  const finalEvents = includeUpdates ? mapped : collapseAlertEvents(mapped);

  return {
    range: { range: picked.range, start: picked.start, end: picked.end },
    events: finalEvents,
  };
}
