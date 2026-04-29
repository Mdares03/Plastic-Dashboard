import { prisma } from "@/lib/prisma";
import { normalizeShiftOverrides } from "@/lib/settings";

type PlannedFilter = "all" | "planned" | "unplanned";
type ShiftFilter = "all" | "A" | "B" | "C";

type ShiftLike = {
  name: string;
  startTime?: string | null;
  endTime?: string | null;
  start?: string | null;
  end?: string | null;
  enabled?: boolean;
};

type ShiftContext = {
  timeZone: string;
  shifts: ShiftLike[];
  overrides: Record<string, ShiftLike[]> | undefined;
};

const SHIFT_ALIAS: ShiftFilter[] = ["A", "B", "C"];
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

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

function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseTimeMinutes(value?: string | null) {
  if (!value || !TIME_RE.test(value)) return null;
  const [hh, mm] = value.split(":");
  return Number(hh) * 60 + Number(mm);
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

function resolveShiftAlias(context: ShiftContext, ts: Date): ShiftFilter | null {
  const dayKey = getLocalDayKey(ts, context.timeZone);
  const dayOverrides = context.overrides?.[dayKey];
  const activeShifts = dayOverrides ?? context.shifts;
  if (!activeShifts.length) return null;

  const nowMin = getLocalMinutes(ts, context.timeZone);
  let enabledOrdinal = 0;
  for (const shift of activeShifts) {
    if (shift.enabled === false) continue;
    const start = parseTimeMinutes(shift.startTime ?? shift.start ?? null);
    const end = parseTimeMinutes(shift.endTime ?? shift.end ?? null);
    if (start == null || end == null) continue;

    const alias = SHIFT_ALIAS[enabledOrdinal] ?? null;
    enabledOrdinal += 1;
    if (!alias) continue;

    if (start <= end) {
      if (nowMin >= start && nowMin < end) return alias;
    } else if (nowMin >= start || nowMin < end) {
      return alias;
    }
  }

  return null;
}

function isMicrostopLike(row: {
  episodeId?: string | null;
  meta?: unknown;
}) {
  const episodeId = String(row.episodeId ?? "").toLowerCase();
  if (episodeId.startsWith("microstop:")) return true;

  const meta = asRecord(row.meta);
  const anomalyType = String(meta?.anomalyType ?? "").toLowerCase();
  if (anomalyType === "microstop") return true;

  const eventType = String(meta?.eventType ?? "").toLowerCase();
  return eventType === "microstop";
}

function normalizePlanned(raw: string | null): PlannedFilter {
  const v = String(raw ?? "").trim().toLowerCase();
  if (v === "planned") return "planned";
  if (v === "unplanned") return "unplanned";
  return "all";
}

export function resolvePlannedFilter(raw: string | null, includeMoldChange: boolean): PlannedFilter {
  const normalized = normalizePlanned(raw);
  if (raw != null && String(raw).trim() !== "") return normalized;
  return includeMoldChange ? "all" : "unplanned";
}

export function normalizeShiftFilter(raw: string | null): ShiftFilter {
  const v = String(raw ?? "").trim().toUpperCase();
  if (v === "A" || v === "B" || v === "C") return v;
  return "all";
}

export function normalizeMicrostopLtMin(raw: string | null) {
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function passesPlannedFilter(reasonCode: string, planned: PlannedFilter) {
  if (planned === "planned") return reasonCode === "MOLD_CHANGE";
  if (planned === "unplanned") return reasonCode !== "MOLD_CHANGE";
  return true;
}

export async function loadDowntimeShiftContext(orgId: string): Promise<ShiftContext> {
  const [shifts, settings] = await Promise.all([
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

  return {
    timeZone: settings?.timezone || "UTC",
    shifts,
    overrides: normalizeShiftOverrides(settings?.shiftScheduleOverridesJson),
  };
}

export function applyDowntimeFilters<T extends {
  reasonCode: string;
  capturedAt: Date;
  durationSeconds?: number | null;
  episodeId?: string | null;
  meta?: unknown;
}>(
  rows: T[],
  options: {
    planned: PlannedFilter;
    shift: ShiftFilter;
    microstopLtMin: number | null;
    shiftContext: ShiftContext | null;
  }
) {
  return rows.filter((row) => {
    if (!passesPlannedFilter(row.reasonCode, options.planned)) return false;

    if (options.shift !== "all") {
      if (!options.shiftContext) return false;
      const alias = resolveShiftAlias(options.shiftContext, row.capturedAt);
      if (alias !== options.shift) return false;
    }

    if (options.microstopLtMin != null && isMicrostopLike(row)) {
      if (row.durationSeconds == null) return false;
      const durationMin = row.durationSeconds / 60;
      if (!(durationMin < options.microstopLtMin)) return false;
    }

    return true;
  });
}
