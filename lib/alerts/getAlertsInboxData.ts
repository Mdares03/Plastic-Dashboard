import { normalizeShiftOverrides } from "@/lib/settings";
import { prisma } from "@/lib/prisma";
import { MAX_OPEN_EPISODE_MS } from "@/lib/metrics";

/** R5: cap a displayed stoppage duration at 12h, congruent with the downtime-
 *  events list and financial impact (an open/runaway event must not show ~67h). */
function capEpisodeSec(sec: number | null): number | null {
  return sec == null ? null : Math.min(sec, MAX_OPEN_EPISODE_MS / 1000);
}

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
  incidentKey?: string | null;
  isUpdate?: boolean;
  isAutoAck?: boolean;
  notifications?: NotificationStats | null;
};

type NotificationStats = { sent: number; suppressed: number; failed: number };

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
  // Group by incidentKey (preferred — stable across the entire incident lifecycle)
  // OR alertId (fallback — for older or non-stoppage events).
  // Per group, keep AT MOST one "active" (oldest = when it first happened) and
  // one "resolved" (newest = when it actually ended). Result: max 2 entries per incident.
  const byGroup = new Map<string, AlertsInboxEvent>();
  const passthrough: AlertsInboxEvent[] = [];

  for (const ev of events) {
    const groupId = ev.incidentKey ?? ev.alertId;
    if (!groupId) {
      passthrough.push(ev);
      continue;
    }
    const statusKey = ev.status === "resolved" ? "resolved" : "active";
    const key = `${groupId}:${statusKey}`;
    const existing = byGroup.get(key);
    if (!existing) {
      byGroup.set(key, ev);
      continue;
    }
    const pickNewest = statusKey === "resolved";
    const shouldReplace = pickNewest
      ? ev.ts.getTime() > existing.ts.getTime()
      : ev.ts.getTime() < existing.ts.getTime();
    if (shouldReplace) byGroup.set(key, ev);
  }

  const combined = [...passthrough, ...byGroup.values()];
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
    // Drop only auto-ack pings (every-10s refresh noise).
    // Keep is_update events: due to a Node-RED spread inheritance pattern,
    // virtually all events carry is_update=true even legitimate first-emission
    // and cycle-arrival resolved events. Dedup happens via collapseAlertEvents
    // grouping by incidentKey below.
    if (!includeUpdates && isAutoAck) continue;

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
      durationSec: capEpisodeSec(extractDurationSec(ev.data)),
      status: statusLabel,
      shift: shiftName,
      alertId: safeString(payload?.alert_id ?? inner?.alert_id),
      incidentKey: safeString(payload?.incidentKey ?? payload?.incident_key ?? inner?.incidentKey ?? inner?.incident_key),
      isUpdate,
      isAutoAck,
    });
  }

  const finalEvents = includeUpdates ? mapped : collapseAlertEvents(mapped);

  // Surface delivery outcome per incident (sent / suppressed / failed) so the
  // inbox shows that throttled alerts were *intentionally* held, not lost — the
  // observable proof of the circuit breaker (Phase 4).
  const incidentKeys = [
    ...new Set(finalEvents.map((e) => e.incidentKey).filter((k): k is string => !!k)),
  ];
  const statsByIncident = new Map<string, NotificationStats>();
  if (incidentKeys.length) {
    const grouped = await prisma.alertNotification.groupBy({
      by: ["incidentKey", "status"],
      where: { orgId, incidentKey: { in: incidentKeys } },
      _count: { _all: true },
    });
    for (const g of grouped) {
      if (!g.incidentKey) continue;
      const cur = statsByIncident.get(g.incidentKey) ?? { sent: 0, suppressed: 0, failed: 0 };
      const count = g._count._all ?? 0;
      if (g.status === "sent") cur.sent += count;
      else if (g.status === "suppressed") cur.suppressed += count;
      else if (g.status === "failed") cur.failed += count;
      statsByIncident.set(g.incidentKey, cur);
    }
  }

  const eventsWithStats = finalEvents.map((e) => ({
    ...e,
    notifications: e.incidentKey
      ? statsByIncident.get(e.incidentKey) ?? { sent: 0, suppressed: 0, failed: 0 }
      : null,
  }));

  const notificationSummary: NotificationStats = { sent: 0, suppressed: 0, failed: 0 };
  for (const s of statsByIncident.values()) {
    notificationSummary.sent += s.sent;
    notificationSummary.suppressed += s.suppressed;
    notificationSummary.failed += s.failed;
  }

  return {
    range: { range: picked.range, start: picked.start, end: picked.end },
    events: eventsWithStats,
    notificationSummary,
  };
}
