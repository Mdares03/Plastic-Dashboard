/**
 * Shift authority — the one definition of "is this instant inside a planned
 * production shift?", and "which shift is it?".
 *
 * Both the dashboard/recap downtime (lib/recap/getRecapData) and the reports family
 * (lib/reports/queries/{losses,classificationRate,downtimeByShift}) filter through
 * this, so a stop is counted the same on every screen — the "shift-aware everywhere"
 * rule. Before this module each side had its own copy and they could (and did) drift.
 *
 * 24/7 guard: an org with NO usable shift schedule is treated as always-in-shift, so
 * the mere absence of a schedule never silently zeroes downtime on the reports while
 * the dashboard still shows it. A schedule must exist to start excluding off-shift time.
 */

export type ShiftLike = {
  name: string;
  startTime?: string | null;
  endTime?: string | null;
  start?: string | null;
  end?: string | null;
  enabled?: boolean;
};

export type ShiftPlanningContext = {
  timeZone: string;
  shifts: ShiftLike[];
  overrides: Record<string, ShiftLike[]> | undefined;
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

function parseTimeMinutes(value?: string | null): number | null {
  if (!value || !TIME_RE.test(value)) return null;
  const [hh, mm] = value.split(":");
  return Number(hh) * 60 + Number(mm);
}

function getLocalMinutes(ts: Date, timeZone: string): number {
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
    const weekday = new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short" }).format(ts);
    return WEEKDAY_KEY_MAP[weekday] ?? WEEKDAY_KEYS[ts.getUTCDay()] ?? "sun";
  } catch {
    return WEEKDAY_KEYS[ts.getUTCDay()] ?? "sun";
  }
}

function activeShiftsFor(ctx: ShiftPlanningContext, ts: Date): ShiftLike[] {
  const dayKey = getDayKey(ts, ctx.timeZone);
  return ctx.overrides?.[dayKey] ?? ctx.shifts;
}

function countUsable(shifts: ShiftLike[]): number {
  let n = 0;
  for (const s of shifts) {
    if (s.enabled === false) continue;
    if (parseTimeMinutes(s.startTime ?? s.start ?? null) == null) continue;
    if (parseTimeMinutes(s.endTime ?? s.end ?? null) == null) continue;
    n += 1;
  }
  return n;
}

/** True if the org defines at least one usable shift (in the base set or any override). */
export function hasPlannedShifts(ctx: ShiftPlanningContext): boolean {
  if (countUsable(ctx.shifts) > 0) return true;
  if (ctx.overrides) {
    for (const key of Object.keys(ctx.overrides)) {
      if (countUsable(ctx.overrides[key] ?? []) > 0) return true;
    }
  }
  return false;
}

/** Name of the shift `ts` falls in, or null if it falls in no configured shift. */
export function resolveShiftName(ctx: ShiftPlanningContext, ts: Date): string | null {
  const activeShifts = activeShiftsFor(ctx, ts);
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

/**
 * Whether `ts` is inside a planned production shift. Orgs with no usable schedule are
 * treated as 24/7 (always true) so missing config never zeroes the reports.
 */
export function isInPlannedShift(ctx: ShiftPlanningContext, ts: Date): boolean {
  if (!hasPlannedShifts(ctx)) return true; // 24/7 guard
  return resolveShiftName(ctx, ts) != null;
}
