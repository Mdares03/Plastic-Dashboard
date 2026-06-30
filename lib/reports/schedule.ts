/**
 * Report-schedule due-ness + recipient resolution (item 1).
 *
 * The scheduled-email cron endpoints fan out across every org and call these pure
 * helpers to decide, per org, whether a given report is due *now* and who should
 * receive it. Keeping the cadence math here (not in the route) makes it unit-testable
 * and lets the daily/weekly/roi endpoints share one definition of "due".
 *
 * Cadence model: each schedule has a "scheduled instant" — the most recent
 * dayOfWeek/dayOfMonth at hourUtc at-or-before `now`. A report is due when that
 * instant has passed and we have not sent since it. The cron may therefore run more
 * often than the cadence (e.g. hourly) without double-sending, because `lastSentAt`
 * dedupes within the period.
 */

export type ReportType = "daily" | "weekly" | "roi";
export type ReportFrequency = "daily" | "weekly" | "monthly";

export const REPORT_TYPES: ReportType[] = ["daily", "weekly", "roi"];

export type ReportSchedule = {
  reportType: ReportType;
  enabled: boolean;
  frequency: ReportFrequency;
  recipients: string[];
  hourUtc: number;
  /** 0=Sunday … 6=Saturday. Used when frequency = weekly. */
  dayOfWeek: number | null;
  /** 1–28. Used when frequency = monthly. */
  dayOfMonth: number | null;
  lastSentAt: Date | null;
};

/**
 * Defaults applied when an org has no explicit schedule row for a report type.
 * `weekly` and `roi` default to enabled so the existing scheduled emails keep
 * flowing for orgs that never touch the new UI; `daily` is opt-in (off by default).
 */
export function defaultSchedule(reportType: ReportType): ReportSchedule {
  switch (reportType) {
    case "daily":
      return {
        reportType,
        enabled: false,
        frequency: "daily",
        recipients: [],
        hourUtc: 13,
        dayOfWeek: null,
        dayOfMonth: null,
        lastSentAt: null,
      };
    case "roi":
      return {
        reportType,
        enabled: true,
        frequency: "monthly",
        recipients: [],
        hourUtc: 13,
        dayOfWeek: null,
        dayOfMonth: 1,
        lastSentAt: null,
      };
    case "weekly":
    default:
      return {
        reportType: "weekly",
        enabled: true,
        frequency: "weekly",
        recipients: [],
        hourUtc: 13,
        dayOfWeek: 1,
        dayOfMonth: null,
        lastSentAt: null,
      };
  }
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function isFrequency(value: unknown): value is ReportFrequency {
  return value === "daily" || value === "weekly" || value === "monthly";
}

/** Normalize a raw Prisma row (or partial override) into a complete ReportSchedule. */
export function normalizeSchedule(
  reportType: ReportType,
  row: Partial<{
    enabled: boolean;
    frequency: string;
    recipients: string[] | null;
    hourUtc: number;
    dayOfWeek: number | null;
    dayOfMonth: number | null;
    lastSentAt: Date | string | null;
  }> | null | undefined
): ReportSchedule {
  const base = defaultSchedule(reportType);
  if (!row) return base;

  const lastSentAt =
    row.lastSentAt == null
      ? null
      : row.lastSentAt instanceof Date
        ? row.lastSentAt
        : new Date(row.lastSentAt);

  return {
    reportType,
    enabled: typeof row.enabled === "boolean" ? row.enabled : base.enabled,
    frequency: isFrequency(row.frequency) ? row.frequency : base.frequency,
    recipients: Array.isArray(row.recipients) ? row.recipients : base.recipients,
    hourUtc: clampInt(row.hourUtc, 0, 23, base.hourUtc),
    dayOfWeek: row.dayOfWeek == null ? base.dayOfWeek : clampInt(row.dayOfWeek, 0, 6, base.dayOfWeek ?? 1),
    dayOfMonth:
      row.dayOfMonth == null ? base.dayOfMonth : clampInt(row.dayOfMonth, 1, 28, base.dayOfMonth ?? 1),
    lastSentAt: lastSentAt && !Number.isNaN(lastSentAt.getTime()) ? lastSentAt : null,
  };
}

function atUtcHour(year: number, monthIndex: number, day: number, hourUtc: number): Date {
  return new Date(Date.UTC(year, monthIndex, day, hourUtc, 0, 0, 0));
}

/**
 * The current period's scheduled instant (UTC dayOfWeek/dayOfMonth @ hourUtc):
 * today for daily, this Sun–Sat week's occurrence for weekly, this calendar month's
 * day for monthly. May be in the future (we have not reached it this period yet);
 * callers treat `> now` as not-yet-due. Null if the frequency is unrecognized.
 */
export function scheduledInstant(schedule: ReportSchedule, now: Date): Date | null {
  const { frequency, hourUtc } = schedule;

  if (frequency === "daily") {
    return atUtcHour(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hourUtc);
  }

  if (frequency === "weekly") {
    const targetDow = (((schedule.dayOfWeek ?? 1) % 7) + 7) % 7;
    const delta = targetDow - now.getUTCDay(); // this Sun-anchored week's occurrence
    return atUtcHour(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + delta, hourUtc);
  }

  if (frequency === "monthly") {
    const targetDom = clampInt(schedule.dayOfMonth ?? 1, 1, 28, 1);
    return atUtcHour(now.getUTCFullYear(), now.getUTCMonth(), targetDom, hourUtc);
  }

  return null;
}

/** Whether this schedule should send right now (enabled, instant passed, not sent since). */
export function isScheduleDue(schedule: ReportSchedule, now: Date): boolean {
  if (!schedule.enabled) return false;
  const inst = scheduledInstant(schedule, now);
  if (!inst || inst.getTime() > now.getTime()) return false;
  if (!schedule.lastSentAt) return true;
  return schedule.lastSentAt.getTime() < inst.getTime();
}

function normalizeEmail(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || !trimmed.includes("@")) return null;
  return trimmed;
}

/** Dedupe (case-insensitive) and drop blanks/invalid, preserving first-seen casing/order. */
export function dedupeEmails(emails: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of emails) {
    if (!raw) continue;
    const email = normalizeEmail(raw);
    if (!email) continue;
    const key = email.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(email);
  }
  return out;
}

/**
 * Recipients for a send: explicit schedule recipients when set, otherwise the org's
 * active alert-contact emails (the legacy fan-out target).
 */
export function resolveRecipients(
  scheduleRecipients: string[],
  fallbackContactEmails: Array<string | null | undefined>
): string[] {
  const explicit = dedupeEmails(scheduleRecipients);
  if (explicit.length) return explicit;
  return dedupeEmails(fallbackContactEmails);
}
