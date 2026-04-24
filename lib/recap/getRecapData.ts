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
const CACHE_TTL_SEC = 180;
const MOLD_IDLE_MIN = 10;

function safeNum(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return null;
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

  return (
    safeNum(inner.stoppage_duration_seconds) ??
    safeNum(inner.stop_duration_seconds) ??
    safeNum(inner.duration_seconds) ??
    safeNum(record?.durationSeconds) ??
    0
  );
}

function avg(sum: number, count: number) {
  if (!count) return null;
  return round2(sum / count);
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
    select: { id: true, name: true, location: true },
  });

  if (!machines.length) {
    return {
      range: { start: params.start.toISOString(), end: params.end.toISOString() },
      machines: [],
    };
  }

  const machineIds = machines.map((m) => m.id);
  const [settings, shifts, cyclesRaw, kpisRaw, eventsRaw, reasonsRaw, workOrdersRaw, hbRangeRaw, hbLatestRaw] =
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
          workOrderId: true,
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
        select: {
          machineId: true,
          ts: true,
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
          ts: { lte: params.end },
        },
        orderBy: [{ machineId: "asc" }, { ts: "desc" }],
        distinct: ["machineId"],
        select: {
          machineId: true,
          ts: true,
          tsServer: true,
          status: true,
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
  const cyclesAllByMachine = new Map<string, typeof cyclesRaw>();
  const kpisByMachine = new Map<string, typeof kpis>();
  const eventsByMachine = new Map<string, typeof events>();
  const reasonsByMachine = new Map<string, typeof reasons>();
  const workOrdersByMachine = new Map<string, typeof workOrdersRaw>();
  const hbRangeByMachine = new Map<string, typeof hbRange>();
  const hbLatestByMachine = new Map(hbLatestRaw.map((row) => [row.machineId, row]));

  for (const row of cycles) {
    const list = cyclesByMachine.get(row.machineId) ?? [];
    list.push(row);
    cyclesByMachine.set(row.machineId, list);
  }

  for (const row of cyclesRaw) {
    const list = cyclesAllByMachine.get(row.machineId) ?? [];
    list.push(row);
    cyclesAllByMachine.set(row.machineId, list);
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

  const machineRows: RecapMachine[] = machines.map((machine) => {
    const machineCycles = cyclesByMachine.get(machine.id) ?? [];
    const machineCyclesAll = cyclesAllByMachine.get(machine.id) ?? [];
    const machineKpis = kpisByMachine.get(machine.id) ?? [];
    const machineEvents = eventsByMachine.get(machine.id) ?? [];
    const machineReasons = reasonsByMachine.get(machine.id) ?? [];
    const machineWorkOrders = workOrdersByMachine.get(machine.id) ?? [];
    const machineHbRange = hbRangeByMachine.get(machine.id) ?? [];
    const latestHb = hbLatestByMachine.get(machine.id) ?? null;

    const targetBySku = new Map<string, number>();
    for (const wo of machineWorkOrders) {
      if (!wo.sku || wo.targetQty == null) continue;
      targetBySku.set(wo.sku, (targetBySku.get(wo.sku) ?? 0) + Number(wo.targetQty));
    }

    const skuMap = new Map<string, { sku: string; good: number; scrap: number; target: number | null }>();
    let goodParts = 0;
    let scrapParts = 0;

    for (const cycle of machineCycles) {
      const sku = cycle.sku || "N/A";
      const good = safeNum(cycle.goodDelta) ?? 0;
      const scrap = safeNum(cycle.scrapDelta) ?? 0;
      goodParts += good;
      scrapParts += scrap;

      const row = skuMap.get(sku) ?? {
        sku,
        good: 0,
        scrap: 0,
        target: targetBySku.has(sku) ? targetBySku.get(sku) ?? null : null,
      };
      row.good += good;
      row.scrap += scrap;
      skuMap.set(sku, row);
    }

    const bySku = [...skuMap.values()]
      .map((row) => {
        const produced = row.good + row.scrap;
        const progressPct = row.target && row.target > 0 ? round2((produced / row.target) * 100) : null;
        return { ...row, progressPct };
      })
      .sort((a, b) => b.good - a.good);

    let oeeSum = 0;
    let oeeCount = 0;
    let availabilitySum = 0;
    let availabilityCount = 0;
    let performanceSum = 0;
    let performanceCount = 0;
    let qualitySum = 0;
    let qualityCount = 0;

    for (const kpi of machineKpis) {
      const oee = safeNum(kpi.oee);
      const availability = safeNum(kpi.availability);
      const performance = safeNum(kpi.performance);
      const quality = safeNum(kpi.quality);

      if (oee != null) {
        oeeSum += oee;
        oeeCount += 1;
      }
      if (availability != null) {
        availabilitySum += availability;
        availabilityCount += 1;
      }
      if (performance != null) {
        performanceSum += performance;
        performanceCount += 1;
      }
      if (quality != null) {
        qualitySum += quality;
        qualityCount += 1;
      }
    }

    let stopDurSecFromEvents = 0;
    let stopsCount = 0;
    for (const event of machineEvents) {
      const type = String(event.eventType || "").toLowerCase();
      if (!STOP_TYPES.has(type)) continue;
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

    const cyclesByWorkOrder = new Map<
      string,
      { goodParts: number; firstTs: Date | null; lastTs: Date | null }
    >();
    for (const cycle of machineCycles) {
      if (!cycle.workOrderId) continue;
      const current = cyclesByWorkOrder.get(cycle.workOrderId) ?? {
        goodParts: 0,
        firstTs: null,
        lastTs: null,
      };
      current.goodParts += safeNum(cycle.goodDelta) ?? 0;
      if (!current.firstTs || cycle.ts < current.firstTs) current.firstTs = cycle.ts;
      if (!current.lastTs || cycle.ts > current.lastTs) current.lastTs = cycle.ts;
      cyclesByWorkOrder.set(cycle.workOrderId, current);
    }

    const completed = machineWorkOrders
      .filter((wo) => String(wo.status).toUpperCase() === "COMPLETED")
      .filter((wo) => wo.updatedAt >= params.start && wo.updatedAt <= params.end)
      .map((wo) => {
        const progress = cyclesByWorkOrder.get(wo.workOrderId) ?? {
          goodParts: 0,
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

    const activeWo = machineWorkOrders.find((wo) => String(wo.status).toUpperCase() !== "COMPLETED") ?? null;

    let activeProgressPct: number | null = null;
    let activeStartedAt: string | null = null;
    if (activeWo) {
      const progress = cyclesByWorkOrder.get(activeWo.workOrderId);
      const produced = (progress?.goodParts ?? 0) + (machineCycles
        .filter((row) => row.workOrderId === activeWo.workOrderId)
        .reduce((sum, row) => sum + (safeNum(row.scrapDelta) ?? 0), 0));
      if (activeWo.targetQty && activeWo.targetQty > 0) {
        activeProgressPct = round2((produced / activeWo.targetQty) * 100);
      }
      activeStartedAt = toIso(progress?.firstTs ?? activeWo.createdAt);
    }

    const cutoffTs = new Date(params.end.getTime() - MOLD_IDLE_MIN * 60000);
    const hasRecentCycle = machineCyclesAll.some((cycle) => cycle.ts >= cutoffTs && cycle.ts <= params.end);
    const moldChangeInProgress =
      !!activeWo && String(activeWo.status).toUpperCase() === "PENDING" && !hasRecentCycle;

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
        totalCycles: machineCycles.length,
        bySku,
      },
      oee: {
        avg: avg(oeeSum, oeeCount),
        availability: avg(availabilitySum, availabilityCount),
        performance: avg(performanceSum, performanceCount),
        quality: avg(qualitySum, qualityCount),
      },
      downtime: {
        totalMin,
        stopsCount,
        topReasons,
        ongoingStopMin,
      },
      workOrders: {
        completed,
        active: activeWo
          ? {
              id: activeWo.workOrderId,
              sku: activeWo.sku,
              progressPct: activeProgressPct,
              startedAt: activeStartedAt,
            }
          : null,
        moldChangeInProgress,
      },
      heartbeat: {
        lastSeenAt: toIso(latestTs),
        uptimePct,
      },
    };
  });

  return {
    range: {
      start: params.start.toISOString(),
      end: params.end.toISOString(),
    },
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
