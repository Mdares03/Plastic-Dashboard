import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";
import { normalizeShiftOverrides, type ShiftOverrideDay } from "@/lib/settings";
import type { RecapMachine, RecapQuery, RecapResponse } from "@/lib/recap/types";

type ShiftLike = {
  name: string;
  startTime?: string | null;
  endTime?: string | null;
  start?: string | null;
  end?: string | null;
  enabled?: boolean;
};

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

const STOP_TYPES = new Set(["microstop", "macrostop"]);
const STOP_STATUS = new Set(["STOP", "DOWN", "OFFLINE"]);
const CACHE_TTL_SEC = 60;
const MOLD_LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;
const MOLD_ACTIVE_STALE_MS = 12 * 60 * 60 * 1000;

function safeNum(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
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

function workOrderKey(value: unknown) {
  const token = normalizeToken(value);
  return token ? token.toUpperCase() : "";
}

function skuKey(value: unknown) {
  const token = normalizeToken(value);
  return token ? token.toUpperCase() : "";
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

function toIso(value?: Date | null) {
  return value ? value.toISOString() : null;
}

function round2(value: number) {
  return Math.round(value * 100) / 100;
}

function parseDate(input?: string | null) {
  if (!input) return null;
  const n = Number(input);
  if (!Number.isNaN(n)) return new Date(n);
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

function normalizeRange(start?: Date, end?: Date) {
  const now = new Date();
  const safeEnd = end && Number.isFinite(end.getTime()) ? end : now;
  const defaultStart = new Date(safeEnd.getTime() - 24 * 60 * 60 * 1000);
  const safeStart = start && Number.isFinite(start.getTime()) ? start : defaultStart;
  if (safeStart.getTime() > safeEnd.getTime()) {
    return { start: new Date(safeEnd.getTime() - 24 * 60 * 60 * 1000), end: safeEnd };
  }
  return { start: safeStart, end: safeEnd };
}

function parseTimeMinutes(input?: string | null) {
  if (!input) return null;
  const match = /^(\d{2}):(\d{2})$/.exec(input.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (!Number.isInteger(h) || !Number.isInteger(m) || h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

function getLocalMinutes(ts: Date, timeZone: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(ts);
    const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
    const m = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
    return h * 60 + m;
  } catch {
    return ts.getUTCHours() * 60 + ts.getUTCMinutes();
  }
}

function getLocalDayKey(ts: Date, timeZone: string): ShiftOverrideDay {
  try {
    const weekday = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(ts);
    return WEEKDAY_KEY_MAP[weekday] ?? WEEKDAY_KEYS[ts.getUTCDay()];
  } catch {
    return WEEKDAY_KEYS[ts.getUTCDay()];
  }
}

function resolveShiftName(
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
    } else if (nowMin >= start || nowMin < end) {
      return shift.name;
    }
  }

  return null;
}

function normalizeShiftAlias(shift?: string | null) {
  const normalized = String(shift ?? "").trim().toLowerCase();
  if (!normalized) return null;
  if (normalized === "shift1" || normalized === "shift2" || normalized === "shift3") return normalized;
  return null;
}

function eventDurationSec(data: unknown) {
  const inner = extractEventData(data);
  return (
    safeNum(inner.stoppage_duration_seconds) ??
    safeNum(inner.stop_duration_seconds) ??
    safeNum(inner.duration_seconds) ??
    safeNum(inner.duration_sec) ??
    safeNum(inner.durationSeconds) ??
    0
  );
}

function extractEventData(data: unknown) {
  let blob = data;
  if (typeof blob === "string") {
    try {
      blob = JSON.parse(blob);
    } catch {
      blob = null;
    }
  }
  const record = typeof blob === "object" && blob ? (blob as Record<string, unknown>) : null;
  const innerCandidate = record?.data ?? record ?? {};
  const inner =
    typeof innerCandidate === "object" && innerCandidate !== null
      ? (innerCandidate as Record<string, unknown>)
      : {};
  return inner;
}

function eventStatus(data: unknown) {
  const inner = extractEventData(data);
  return String(inner.status ?? "").trim().toLowerCase();
}

function isRealStopEvent(data: unknown) {
  const inner = extractEventData(data);
  const status = String(inner.status ?? "").trim().toLowerCase();
  const isUpdate = safeBool(inner.is_update ?? inner.isUpdate);
  const isAutoAck = safeBool(inner.is_auto_ack ?? inner.isAutoAck);
  return status !== "active" && !isUpdate && !isAutoAck;
}

function eventIncidentKey(data: unknown, eventType: string, ts: Date) {
  const inner = extractEventData(data);
  const direct = String(inner.incidentKey ?? inner.incident_key ?? "").trim();
  if (direct) return direct;
  const alertId = String(inner.alert_id ?? inner.alertId ?? "").trim();
  if (alertId) return `${eventType}:${alertId}`;
  const startMs = safeNum(inner.start_ms) ?? safeNum(inner.startMs);
  if (startMs != null) return `${eventType}:${Math.trunc(startMs)}`;
  return `${eventType}:${ts.getTime()}`;
}

function moldStartMs(data: unknown, fallbackTs: Date) {
  const inner = extractEventData(data);
  return Math.trunc(safeNum(inner.start_ms) ?? safeNum(inner.startMs) ?? fallbackTs.getTime());
}

export function parseRecapQuery(input: {
  machineId?: string | null;
  start?: string | null;
  end?: string | null;
  shift?: string | null;
}) {
  return {
    machineId: input.machineId ? String(input.machineId).trim() : undefined,
    start: parseDate(input.start),
    end: parseDate(input.end),
    shift: normalizeShiftAlias(input.shift),
  };
}

async function computeRecap(params: Required<Pick<RecapQuery, "orgId">> & {
  machineId?: string;
  start: Date;
  end: Date;
  shift?: string;
}): Promise<RecapResponse> {
  const machineFilter = params.machineId ? { id: params.machineId } : {};
  const machines = await prisma.machine.findMany({
    where: { orgId: params.orgId, ...machineFilter },
    orderBy: { name: "asc" },
    select: { id: true, name: true, location: true, tsServer: true },
  });

  if (!machines.length) {
    return {
      range: { start: params.start.toISOString(), end: params.end.toISOString() },
      availableShifts: [],
      machines: [],
    };
  }

  const machineIds = machines.map((m) => m.id);
  const moldStartLookback = new Date(params.end.getTime() - MOLD_LOOKBACK_MS);
  const [settings, shifts, cyclesRaw, kpisRaw, eventsRaw, reasonsRaw, workOrdersRaw, hbRangeRaw, hbLatestRaw, moldEventsRaw] =
    await Promise.all([
      prisma.orgSettings.findUnique({
        where: { orgId: params.orgId },
        select: { timezone: true, shiftScheduleOverridesJson: true },
      }),
      prisma.orgShift.findMany({
        where: { orgId: params.orgId },
        orderBy: { sortOrder: "asc" },
        select: { name: true, startTime: true, endTime: true, enabled: true, sortOrder: true },
      }),
      prisma.machineCycle.findMany({
        where: {
          orgId: params.orgId,
          machineId: { in: machineIds },
          ts: { gte: params.start, lte: params.end },
        },
        select: {
          machineId: true,
          ts: true,
          cycleCount: true,
          workOrderId: true,
          theoreticalCycleTime: true,
          sku: true,
          goodDelta: true,
          scrapDelta: true,
        },
      }),
      prisma.machineKpiSnapshot.findMany({
        where: {
          orgId: params.orgId,
          machineId: { in: machineIds },
          ts: { gte: params.start, lte: params.end },
        },
        orderBy: [{ machineId: "asc" }, { ts: "asc" }],
        select: {
          machineId: true,
          ts: true,
          workOrderId: true,
          sku: true,
          good: true,
          scrap: true,
          goodParts: true,
          scrapParts: true,
          cycleCount: true,
          oee: true,
          availability: true,
          performance: true,
          quality: true,
        },
      }),
      prisma.machineEvent.findMany({
        where: {
          orgId: params.orgId,
          machineId: { in: machineIds },
          ts: { gte: params.start, lte: params.end },
        },
        select: {
          machineId: true,
          ts: true,
          eventType: true,
          data: true,
        },
      }),
      prisma.reasonEntry.findMany({
        where: {
          orgId: params.orgId,
          machineId: { in: machineIds },
          kind: "downtime",
          reasonCode: { not: "MOLD_CHANGE" },
          capturedAt: { gte: params.start, lte: params.end },
        },
        select: {
          machineId: true,
          capturedAt: true,
          reasonCode: true,
          reasonLabel: true,
          durationSeconds: true,
        },
      }),
      prisma.machineWorkOrder.findMany({
        where: {
          orgId: params.orgId,
          machineId: { in: machineIds },
        },
        orderBy: { updatedAt: "desc" },
        select: {
          machineId: true,
          workOrderId: true,
          sku: true,
          targetQty: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.machineHeartbeat.findMany({
        where: {
          orgId: params.orgId,
          machineId: { in: machineIds },
          ts: { gte: params.start, lte: params.end },
        },
        orderBy: [{ machineId: "asc" }, { ts: "asc" }],
        select: {
          machineId: true,
          ts: true,
          tsServer: true,
          status: true,
        },
      }),
      prisma.machineHeartbeat.findMany({
        where: {
          orgId: params.orgId,
          machineId: { in: machineIds },
          tsServer: { lte: params.end },
        },
        orderBy: [{ machineId: "asc" }, { tsServer: "desc" }],
        distinct: ["machineId"],
        select: {
          machineId: true,
          ts: true,
          tsServer: true,
          status: true,
        },
      }),
      prisma.machineEvent.findMany({
        where: {
          orgId: params.orgId,
          machineId: { in: machineIds },
          eventType: "mold-change",
          ts: { gte: moldStartLookback, lte: params.end },
        },
        orderBy: [{ machineId: "asc" }, { ts: "asc" }],
        select: {
          machineId: true,
          ts: true,
          data: true,
        },
      }),
    ]);

  const timeZone = settings?.timezone || "UTC";
  const shiftOverrides = normalizeShiftOverrides(settings?.shiftScheduleOverridesJson);
  const orderedEnabledShifts = shifts.filter((s) => s.enabled !== false).sort((a, b) => a.sortOrder - b.sortOrder);
  const shiftIndex = params.shift ? Number(params.shift.replace("shift", "")) - 1 : -1;
  const targetShiftName = shiftIndex >= 0 ? orderedEnabledShifts[shiftIndex]?.name ?? "__missing_shift__" : null;

  const inTargetShift = (ts: Date) => {
    if (!targetShiftName) return true;
    const resolved = resolveShiftName(shifts, shiftOverrides, ts, timeZone);
    return resolved === targetShiftName;
  };

  const cycles = targetShiftName ? cyclesRaw.filter((row) => inTargetShift(row.ts)) : cyclesRaw;
  const kpis = targetShiftName ? kpisRaw.filter((row) => inTargetShift(row.ts)) : kpisRaw;
  const events = targetShiftName ? eventsRaw.filter((row) => inTargetShift(row.ts)) : eventsRaw;
  const reasons = targetShiftName ? reasonsRaw.filter((row) => inTargetShift(row.capturedAt)) : reasonsRaw;
  const hbRange = targetShiftName ? hbRangeRaw.filter((row) => inTargetShift(row.ts)) : hbRangeRaw;

  const cyclesByMachine = new Map<string, typeof cycles>();
  const kpisByMachine = new Map<string, typeof kpis>();
  const eventsByMachine = new Map<string, typeof events>();
  const reasonsByMachine = new Map<string, typeof reasons>();
  const workOrdersByMachine = new Map<string, typeof workOrdersRaw>();
  const hbRangeByMachine = new Map<string, typeof hbRange>();
  const hbLatestByMachine = new Map(hbLatestRaw.map((row) => [row.machineId, row]));
  const moldEventsByMachine = new Map<string, typeof moldEventsRaw>();

  for (const row of cycles) {
    const list = cyclesByMachine.get(row.machineId) ?? [];
    list.push(row);
    cyclesByMachine.set(row.machineId, list);
  }

  for (const row of kpis) {
    const list = kpisByMachine.get(row.machineId) ?? [];
    list.push(row);
    kpisByMachine.set(row.machineId, list);
  }

  for (const row of events) {
    const list = eventsByMachine.get(row.machineId) ?? [];
    list.push(row);
    eventsByMachine.set(row.machineId, list);
  }

  for (const row of reasons) {
    const list = reasonsByMachine.get(row.machineId) ?? [];
    list.push(row);
    reasonsByMachine.set(row.machineId, list);
  }

  for (const row of workOrdersRaw) {
    const list = workOrdersByMachine.get(row.machineId) ?? [];
    list.push(row);
    workOrdersByMachine.set(row.machineId, list);
  }

  for (const row of hbRange) {
    const list = hbRangeByMachine.get(row.machineId) ?? [];
    list.push(row);
    hbRangeByMachine.set(row.machineId, list);
  }

  for (const row of moldEventsRaw) {
    const list = moldEventsByMachine.get(row.machineId) ?? [];
    list.push(row);
    moldEventsByMachine.set(row.machineId, list);
  }

  const machineRows: RecapMachine[] = machines.map((machine) => {
    const machineCycles = cyclesByMachine.get(machine.id) ?? [];
    const machineKpis = kpisByMachine.get(machine.id) ?? [];
    const machineEvents = eventsByMachine.get(machine.id) ?? [];
    const machineReasons = reasonsByMachine.get(machine.id) ?? [];
    const machineWorkOrders = workOrdersByMachine.get(machine.id) ?? [];
    const machineHbRange = hbRangeByMachine.get(machine.id) ?? [];
    const latestHb = hbLatestByMachine.get(machine.id) ?? null;
    const machineMoldEvents = moldEventsByMachine.get(machine.id) ?? [];

    const dedupedCycles = dedupeByKey(
      machineCycles,
      (cycle) =>
        `${cycle.ts.getTime()}:${safeNum(cycle.cycleCount) ?? "na"}:${workOrderKey(cycle.workOrderId)}:${skuKey(cycle.sku)}:${safeNum(cycle.goodDelta) ?? "na"}:${safeNum(cycle.scrapDelta) ?? "na"}`
    );
    const dedupedKpis = dedupeByKey(
      machineKpis,
      (kpi) =>
        `${kpi.ts.getTime()}:${workOrderKey(kpi.workOrderId)}:${skuKey(kpi.sku)}:${safeNum(kpi.goodParts) ?? safeNum(kpi.good) ?? "na"}:${safeNum(kpi.scrapParts) ?? safeNum(kpi.scrap) ?? "na"}:${safeNum(kpi.cycleCount) ?? "na"}`
    );
    const machineWorkOrdersSorted = [...machineWorkOrders].sort(
      (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()
    );

    const targetBySku = new Map<string, { sku: string; target: number }>();
    for (const wo of machineWorkOrdersSorted) {
      const sku = normalizeToken(wo.sku);
      const target = safeNum(wo.targetQty);
      if (!sku || target == null || target <= 0) continue;
      const key = skuKey(sku);
      const current = targetBySku.get(key);
      if (current) {
        current.target += Math.max(0, Math.trunc(target));
      } else {
        targetBySku.set(key, { sku, target: Math.max(0, Math.trunc(target)) });
      }
    }

    type SkuAggregate = {
      machineName: string;
      sku: string;
      good: number;
      scrap: number;
      target: number | null;
    };
    let latestTelemetry: { ts: Date; workOrderId: string | null; sku: string | null } | null = null;

    for (const kpi of dedupedKpis) {
      if (!latestTelemetry || kpi.ts > latestTelemetry.ts) {
        latestTelemetry = {
          ts: kpi.ts,
          workOrderId: normalizeToken(kpi.workOrderId) || null,
          sku: normalizeToken(kpi.sku) || null,
        };
      }
    }

    if (!latestTelemetry) {
      for (const cycle of dedupedCycles) {
        if (!latestTelemetry || cycle.ts > latestTelemetry.ts) {
          latestTelemetry = {
            ts: cycle.ts,
            workOrderId: normalizeToken(cycle.workOrderId) || null,
            sku: normalizeToken(cycle.sku) || null,
          };
        }
      }
    }

    const openWorkOrders = machineWorkOrdersSorted.filter(
      (wo) => String(wo.status).toUpperCase() !== "COMPLETED"
    );
    const rangeWorkOrderProgress = new Map<
      string,
      { goodParts: number; scrapParts: number; cycleCount: number; firstTs: Date | null; lastTs: Date | null }
    >();
    const authoritativeSkuMap = new Map<string, SkuAggregate>();
    let goodParts = 0;
    let scrapParts = 0;
    let authoritativeCycleCount = 0;

    const ensureAuthoritativeSku = (
      skuInput: string | null,
      targetInput?: number | null,
      useFallbackTarget = true
    ) => {
      const skuToken = normalizeToken(skuInput) || "N/A";
      const skuTokenKey = skuKey(skuToken);
      const targetFallback = useFallbackTarget ? targetBySku.get(skuTokenKey)?.target ?? null : null;
      const explicitTarget =
        targetInput != null && targetInput > 0 ? Math.max(0, Math.trunc(targetInput)) : null;
      const normalizedTarget = explicitTarget ?? targetFallback;
      const existing = authoritativeSkuMap.get(skuTokenKey);
      if (existing) {
        if (explicitTarget != null) {
          existing.target = (existing.target ?? 0) + explicitTarget;
        } else if (normalizedTarget != null && existing.target == null) {
          existing.target = normalizedTarget;
        }
        return existing;
      }
      const created: SkuAggregate = {
        machineName: machine.name,
        sku: skuToken,
        good: 0,
        scrap: 0,
        target: normalizedTarget,
      };
      authoritativeSkuMap.set(skuTokenKey, created);
      return created;
    };

    for (const cycle of dedupedCycles) {
      const skuRaw = normalizeToken(cycle.sku);
      const g = Math.max(0, Math.trunc(safeNum(cycle.goodDelta) ?? 0));
      const s = Math.max(0, Math.trunc(safeNum(cycle.scrapDelta) ?? 0));
      const woKey = workOrderKey(cycle.workOrderId);
      authoritativeCycleCount += 1;
      if (g === 0 && s === 0) continue;
      goodParts += g;
      scrapParts += s;
      if (woKey) {
        const progress = rangeWorkOrderProgress.get(woKey) ?? {
          goodParts: 0,
          scrapParts: 0,
          cycleCount: 0,
          firstTs: null,
          lastTs: null,
        };
        progress.goodParts += g;
        progress.scrapParts += s;
        progress.cycleCount += 1;
        if (!progress.firstTs || cycle.ts < progress.firstTs) progress.firstTs = cycle.ts;
        if (!progress.lastTs || cycle.ts > progress.lastTs) progress.lastTs = cycle.ts;
        rangeWorkOrderProgress.set(woKey, progress);
      }
      if (!skuRaw) continue;
      const skuAgg = ensureAuthoritativeSku(skuRaw, null, true);
      skuAgg.good += g;
      skuAgg.scrap += s;
    }

     const bySku = [...authoritativeSkuMap.values()]
      .map((row) => ({
        machineName: row.machineName,
        sku: row.sku,
        good: row.good,
        scrap: row.scrap,
        target: null as number | null,
        progressPct: null as number | null,
      }))
      .sort((a, b) => b.good - a.good);

    const sortedKpis = [...dedupedKpis].sort((a, b) => a.ts.getTime() - b.ts.getTime());
    const weightedAvg = (field: "oee" | "availability" | "performance" | "quality") => {
      if (!sortedKpis.length) return null;
      let totalMs = 0;
      let weightedSum = 0;

      for (let i = 0; i < sortedKpis.length; i += 1) {
        const current = sortedKpis[i];
        const nextTsMs = (sortedKpis[i + 1]?.ts ?? params.end).getTime();
        const dt = Math.max(0, nextTsMs - current.ts.getTime());
        if (dt <= 0) continue;
        weightedSum += (safeNum(current[field]) ?? 0) * dt;
        totalMs += dt;
      }

      return totalMs > 0 ? round2(weightedSum / totalMs) : null;
    };

    let stopDurSecFromEvents = 0;
    let stopsCount = 0;
    for (const event of machineEvents) {
      const type = String(event.eventType || "").toLowerCase();
      if (!STOP_TYPES.has(type)) continue;
      if (!isRealStopEvent(event.data)) continue;
      stopsCount += 1;
      stopDurSecFromEvents += eventDurationSec(event.data);
    }

    const reasonAgg = new Map<string, { reasonLabel: string; seconds: number; count: number }>();
    let stopDurSecFromReasons = 0;
    for (const reason of machineReasons) {
      const label = reason.reasonLabel?.trim() || reason.reasonCode || "Sin razón";
      const seconds = Math.max(0, safeNum(reason.durationSeconds) ?? 0);
      stopDurSecFromReasons += seconds;
      const agg = reasonAgg.get(label) ?? { reasonLabel: label, seconds: 0, count: 0 };
      agg.seconds += seconds;
      agg.count += 1;
      reasonAgg.set(label, agg);
    }

    const topReasons = [...reasonAgg.values()]
      .sort((a, b) => b.seconds - a.seconds)
      .slice(0, 3)
      .map((row) => ({
        reasonLabel: row.reasonLabel,
        minutes: round2(row.seconds / 60),
        count: row.count,
      }));

    const totalMin = round2(Math.max(stopDurSecFromEvents, stopDurSecFromReasons) / 60);

    let ongoingStopMin: number | null = null;
    const latestStatus = String(latestHb?.status ?? "").toUpperCase();
    const latestTs = latestHb?.tsServer ?? latestHb?.ts ?? null;
    if (latestTs && STOP_STATUS.has(latestStatus)) {
      let downStart = latestTs;
      for (let i = machineHbRange.length - 1; i >= 0; i -= 1) {
        const hb = machineHbRange[i];
        const hbStatus = String(hb.status ?? "").toUpperCase();
        if (!STOP_STATUS.has(hbStatus)) break;
        downStart = hb.tsServer ?? hb.ts;
      }
      ongoingStopMin = round2(Math.max(0, (params.end.getTime() - downStart.getTime()) / 60000));
    }

    const completed = machineWorkOrdersSorted
      .filter((wo) => String(wo.status).toUpperCase() === "COMPLETED")
      .filter((wo) => wo.updatedAt >= params.start && wo.updatedAt <= params.end)
      .map((wo) => {
        const progress = rangeWorkOrderProgress.get(workOrderKey(wo.workOrderId)) ?? {
          goodParts: 0,
          scrapParts: 0,
          cycleCount: 0,
          firstTs: null,
          lastTs: null,
        };
        const durationHrs =
          progress.firstTs && progress.lastTs
            ? round2((progress.lastTs.getTime() - progress.firstTs.getTime()) / 3600000)
            : 0;
        return {
          id: wo.workOrderId,
          sku: wo.sku,
          goodParts: progress.goodParts,
          durationHrs,
        };
      })
      .sort((a, b) => b.goodParts - a.goodParts);

    const telemetryWorkOrderKey = workOrderKey(latestTelemetry?.workOrderId);
    const matchedTelemetryWo = telemetryWorkOrderKey
      ? openWorkOrders.find((wo) => workOrderKey(wo.workOrderId) === telemetryWorkOrderKey) ?? null
      : null;
    const activeWo = matchedTelemetryWo ?? openWorkOrders[0] ?? null;
    const activeWorkOrderId =
      normalizeToken(latestTelemetry?.workOrderId) || normalizeToken(activeWo?.workOrderId) || null;
    const activeWorkOrderSku =
      normalizeToken(latestTelemetry?.sku) || normalizeToken(activeWo?.sku) || null;
    const activeWorkOrderKey = workOrderKey(activeWorkOrderId);
    const activeTargetSource =
      activeWorkOrderKey
        ? machineWorkOrdersSorted.find((wo) => workOrderKey(wo.workOrderId) === activeWorkOrderKey) ??
          activeWo
        : activeWo;

    let activeProgressPct: number | null = null;
    let activeStartedAt: string | null = null;
    if (activeWorkOrderId) {
      const rangeProgress = activeWorkOrderKey ? rangeWorkOrderProgress.get(activeWorkOrderKey) ?? null : null;
      const producedForProgress = rangeProgress
        ? rangeProgress.goodParts + rangeProgress.scrapParts
        : 0;
      const targetQty = safeNum(activeTargetSource?.targetQty);
      if (targetQty && targetQty > 0) {
        activeProgressPct = round2((producedForProgress / targetQty) * 100);
      }
      activeStartedAt = toIso(rangeProgress?.firstTs ?? latestTelemetry?.ts ?? null);
    }

    const firstProductionMsAfterMoldStart = (startMs: number) => {
      let best: number | null = null;
      for (const cycle of dedupedCycles) {
        const t = cycle.ts.getTime();
        if (t <= startMs) continue;
        const g = safeNum(cycle.goodDelta) ?? 0;
        const s = safeNum(cycle.scrapDelta) ?? 0;
        if (g > 0 || s > 0) {
          if (best == null || t < best) best = t;
        }
      }
      for (const kpi of dedupedKpis) {
        const t = kpi.ts.getTime();
        if (t <= startMs) continue;
        const g = safeNum(kpi.good) ?? safeNum(kpi.goodParts) ?? 0;
        const s = safeNum(kpi.scrap) ?? safeNum(kpi.scrapParts) ?? 0;
        if (g > 0 || s > 0) {
          if (best == null || t < best) best = t;
        }
      }
      return best;
    };

    const moldActiveByIncident = new Map<string, number>();
    for (const event of machineMoldEvents) {
      const inner = extractEventData(event.data);
      const isUpdate = safeBool(inner.is_update ?? inner.isUpdate);
      const isAutoAck = safeBool(inner.is_auto_ack ?? inner.isAutoAck);
      if (isUpdate || isAutoAck) continue;

      const key = eventIncidentKey(event.data, "mold-change", event.ts);
      const status = eventStatus(event.data);
      if (status === "resolved") {
        moldActiveByIncident.delete(key);
        continue;
      }
      if (status === "active" || !status) {
        if (params.end.getTime() - event.ts.getTime() > MOLD_ACTIVE_STALE_MS) continue;
        moldActiveByIncident.set(key, moldStartMs(event.data, event.ts));
      }
    }
    for (const [k, startMs] of [...moldActiveByIncident.entries()]) {
      const resumeMs = firstProductionMsAfterMoldStart(startMs);
      if (resumeMs != null && resumeMs <= params.end.getTime()) {
        moldActiveByIncident.delete(k);
      }
    }
    let moldChangeStartMs: number | null = null;
    for (const startMs of moldActiveByIncident.values()) {
      if (moldChangeStartMs == null || startMs > moldChangeStartMs) moldChangeStartMs = startMs;
    }
    const moldChangeInProgress = moldChangeStartMs != null;

    let uptimePct: number | null = null;
    if (machineHbRange.length) {
      let onlineCount = 0;
      for (const hb of machineHbRange) {
        const status = String(hb.status ?? "").toUpperCase();
        if (!STOP_STATUS.has(status)) onlineCount += 1;
      }
      uptimePct = round2((onlineCount / machineHbRange.length) * 100);
    }

    return {
      machineId: machine.id,
      machineName: machine.name,
      location: machine.location,
      production: {
        goodParts,
        scrapParts,
        totalCycles: authoritativeCycleCount,
        bySku,
      },
      oee: {
        avg: weightedAvg("oee"),
        availability: weightedAvg("availability"),
        performance: weightedAvg("performance"),
        quality: weightedAvg("quality"),
      },
      downtime: {
        totalMin,
        stopsCount,
        topReasons,
        ongoingStopMin,
      },
      workOrders: {
        completed,
        active: activeWorkOrderId
          ? {
              id: activeWorkOrderId,
              sku: activeWorkOrderSku,
              progressPct: activeProgressPct,
              startedAt: activeStartedAt,
            }
          : null,
        moldChangeInProgress,
        moldChangeStartMs,
      },
      heartbeat: {
        lastSeenAt: toIso(
          (() => {
            const hbMs = latestHb ? (latestHb.tsServer ?? latestHb.ts).getTime() : null;
            const machineMs = machine.tsServer.getTime();
            if (hbMs != null) return new Date(Math.max(hbMs, machineMs));
            return machine.tsServer;
          })()
        ),
        uptimePct,
      },
    };
  });

  return {
    range: {
      start: params.start.toISOString(),
      end: params.end.toISOString(),
    },
    availableShifts: orderedEnabledShifts.map((shift, idx) => ({
      id: `shift${idx + 1}`,
      name: shift.name,
    })),
    machines: machineRows,
  };
}

export async function getRecapDataCached(params: RecapQuery): Promise<RecapResponse> {
  const { start, end } = normalizeRange(params.start, params.end);
  const machineId = params.machineId?.trim() || undefined;
  const shift = normalizeShiftAlias(params.shift) ?? undefined;

  const cacheKey = [
    "recap",
    params.orgId,
    machineId ?? "all",
    String(start.getTime()),
    String(end.getTime()),
    shift ?? "all",
  ];

  const cached = unstable_cache(
    () =>
      computeRecap({
        orgId: params.orgId,
        machineId,
        start,
        end,
        shift,
      }),
    cacheKey,
    {
      revalidate: CACHE_TTL_SEC,
      tags: [`recap:${params.orgId}`],
    }
  );

  return cached();
}
