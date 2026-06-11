/**
 * R6 (window authority).
 *
 * One timezone-aware resolver produces every window. Calendar windows
 * (`today`, `yesterday`) are midnight-to-midnight in the org timezone — never
 * rolling. Rolling windows (`7d`, `30d`, `live24h`) end at "now". Every resolved
 * window carries { start, end, mode, timezone, label } so any response can prove
 * which window it rendered, and a UI label can be checked against the mode (a
 * rolling window may not be labeled "Hoy"/"Ayer").
 *
 * The tz math (Intl-based offset resolution) is extracted from
 * lib/recap/redesign.ts so there is one implementation, not several.
 */
import type { ResolvedWindow, WindowMode } from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

const LABELS: Record<WindowMode, string> = {
  today: "Hoy",
  yesterday: "Ayer",
  "7d": "Últimos 7 días",
  "30d": "Últimos 30 días",
  live24h: "Últimas 24 h",
  shift: "Turno",
  custom: "Personalizado",
};

function parseOffsetMinutes(offsetLabel: string | null): number | null {
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

/** Minutes that `timeZone` is offset from UTC at `utcDate` (DST-aware). */
export function getTzOffsetMinutes(utcDate: Date, timeZone: string): number | null {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      timeZoneName: "shortOffset",
      hour: "2-digit",
    }).formatToParts(utcDate);
    const offsetPart = parts.find((p) => p.type === "timeZoneName")?.value ?? null;
    return parseOffsetMinutes(offsetPart);
  } catch {
    return null;
  }
}

/** Local calendar fields of `ts` in `timeZone`. */
export function getLocalParts(ts: Date, timeZone: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(ts);
    const value = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
    const hourRaw = value("hour");
    return {
      year: value("year"),
      month: value("month"),
      day: value("day"),
      hour: hourRaw === 24 ? 0 : hourRaw, // Intl renders local midnight as "24" under hour12:false
      minute: value("minute"),
    };
  } catch {
    return {
      year: ts.getUTCFullYear(),
      month: ts.getUTCMonth() + 1,
      day: ts.getUTCDate(),
      hour: ts.getUTCHours(),
      minute: ts.getUTCMinutes(),
    };
  }
}

/** The UTC instant corresponding to a wall-clock time in `timeZone` (DST-safe). */
export function zonedToUtcDate(input: {
  year: number;
  month: number;
  day: number;
  hours: number;
  minutes: number;
  timeZone: string;
}): Date {
  const baseUtc = Date.UTC(input.year, input.month - 1, input.day, input.hours, input.minutes, 0, 0);
  const offsetA = getTzOffsetMinutes(new Date(baseUtc), input.timeZone);
  if (offsetA == null) return new Date(baseUtc);
  let corrected = new Date(baseUtc - offsetA * 60000);
  const offsetB = getTzOffsetMinutes(corrected, input.timeZone);
  if (offsetB != null && offsetB !== offsetA) {
    corrected = new Date(baseUtc - offsetB * 60000);
  }
  return corrected;
}

/** Local midnight (00:00 in `timeZone`) of the calendar day containing `ts`. */
export function startOfLocalDay(ts: Date, timeZone: string): Date {
  const p = getLocalParts(ts, timeZone);
  return zonedToUtcDate({
    year: p.year,
    month: p.month,
    day: p.day,
    hours: 0,
    minutes: 0,
    timeZone,
  });
}

export type ResolveWindowInput = {
  mode: WindowMode;
  timezone: string;
  now?: Date;
  /** Required for `custom`; optional override for `shift`. */
  start?: Date;
  end?: Date;
  label?: string;
};

/**
 * R6 — resolve any window mode into { start, end, mode, timezone, label }.
 * `shift` defers its schedule math to the caller (normalizeShiftOverrides) and
 * is passed in via start/end here, like `custom`.
 */
export function resolveWindow(input: ResolveWindowInput): ResolvedWindow {
  const timezone = input.timezone || "UTC";
  const now = input.now ?? new Date();
  const label = input.label ?? LABELS[input.mode];
  const base = { mode: input.mode, timezone, label };

  switch (input.mode) {
    case "today": {
      const start = startOfLocalDay(now, timezone);
      // Tomorrow's local midnight. Stepping +36h lands solidly inside tomorrow
      // regardless of a 23h/25h DST day, then snaps to its midnight — a fixed
      // +DAY_MS would be 1h off on the two DST-transition days per year.
      const end = startOfLocalDay(new Date(start.getTime() + DAY_MS + DAY_MS / 2), timezone);
      return { start, end, ...base };
    }
    case "yesterday": {
      const todayStart = startOfLocalDay(now, timezone);
      // Step back 12h (into yesterday afternoon, DST-safe) then take its midnight.
      // A fixed -DAY_MS overshoots into two-days-ago the day after spring-forward,
      // when yesterday was only 23h long.
      const start = startOfLocalDay(new Date(todayStart.getTime() - DAY_MS / 2), timezone);
      return { start, end: todayStart, ...base };
    }
    case "7d":
      return { start: new Date(now.getTime() - 7 * DAY_MS), end: now, ...base };
    case "30d":
      return { start: new Date(now.getTime() - 30 * DAY_MS), end: now, ...base };
    case "live24h":
      return { start: new Date(now.getTime() - DAY_MS), end: now, ...base };
    case "shift":
    case "custom": {
      const end = input.end ?? now;
      const start = input.start ?? new Date(end.getTime() - DAY_MS);
      return { start, end, ...base };
    }
  }
}
