import { prisma } from "@/lib/prisma";
import { normalizeShiftOverrides } from "@/lib/settings";

type ShiftLike = {
  name: string;
  startTime?: string | null;
  endTime?: string | null;
  start?: string | null;
  end?: string | null;
  enabled?: boolean;
};

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const WEEKDAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
const WEEKDAY_KEY_MAP: Record<string, (typeof WEEKDAY_KEYS)[number]> = {
  Sun: "sun",
  Mon: "mon",
  Tue: "tue",
  Wed: "wed",
  Thu: "thu",
  Fri: "fri",
  Sat: "sat",
};

export type ShiftPlanningContext = {
  timeZone: string;
  shifts: ShiftLike[];
  overrides: Record<string, ShiftLike[]> | undefined;
};

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

function getDayKey(ts: Date, timeZone: string): (typeof WEEKDAY_KEYS)[number] {
  try {
    const weekday = new Intl.DateTimeFormat("en-US", {
      timeZone,
      weekday: "short",
    }).format(ts);
    return WEEKDAY_KEY_MAP[weekday] ?? WEEKDAY_KEYS[ts.getUTCDay()] ?? "sun";
  } catch {
    return WEEKDAY_KEYS[ts.getUTCDay()] ?? "sun";
  }
}

export function resolveShiftName(ctx: ShiftPlanningContext, ts: Date): string | null {
  const dayKey = getDayKey(ts, ctx.timeZone);
  const activeShifts = ctx.overrides?.[dayKey] ?? ctx.shifts;
  if (!activeShifts.length) return null;

  const nowMin = getLocalMinutes(ts, ctx.timeZone);
  for (const shift of activeShifts) {
    if (shift.enabled === false) continue;
    const start = parseTimeMinutes(shift.startTime ?? shift.start ?? null);
    const end = parseTimeMinutes(shift.endTime ?? shift.end ?? null);
    if (start == null || end == null) continue;

    if (start <= end) {
      if (nowMin >= start && nowMin < end) return shift.name || null;
    } else if (nowMin >= start || nowMin < end) {
      return shift.name || null;
    }
  }

  return null;
}

export function isInPlannedShift(ctx: ShiftPlanningContext, ts: Date) {
  return resolveShiftName(ctx, ts) != null;
}

export async function loadShiftPlanningContext(orgId: string, timeZoneFallback?: string): Promise<ShiftPlanningContext> {
  const [shifts, settings] = await Promise.all([
    prisma.orgShift.findMany({
      where: { orgId, enabled: true },
      orderBy: { sortOrder: "asc" },
      select: { name: true, startTime: true, endTime: true, enabled: true },
    }),
    prisma.orgSettings.findUnique({
      where: { orgId },
      select: { timezone: true, shiftScheduleOverridesJson: true },
    }),
  ]);

  return {
    timeZone: settings?.timezone || timeZoneFallback || "UTC",
    shifts,
    overrides: normalizeShiftOverrides(settings?.shiftScheduleOverridesJson),
  };
}
