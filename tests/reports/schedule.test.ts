import { describe, expect, it } from "vitest";
import {
  dedupeEmails,
  defaultSchedule,
  isScheduleDue,
  scheduledInstant,
  normalizeSchedule,
  resolveRecipients,
  type ReportSchedule,
} from "@/lib/reports/schedule";

// Item 1: per-org report schedule. The cron endpoints fan out across orgs and rely
// on these pure helpers to decide due-ness (without double-sending) and recipients.

function sched(overrides: Partial<ReportSchedule>): ReportSchedule {
  return { ...defaultSchedule("weekly"), ...overrides };
}

describe("isScheduleDue", () => {
  it("never sends when disabled", () => {
    const s = sched({ enabled: false, frequency: "daily" });
    expect(isScheduleDue(s, new Date("2026-06-30T20:00:00Z"))).toBe(false);
  });

  it("daily: due after the scheduled hour when not yet sent today", () => {
    const s = sched({ enabled: true, frequency: "daily", hourUtc: 13, lastSentAt: null });
    expect(isScheduleDue(s, new Date("2026-06-30T12:59:00Z"))).toBe(false); // before hour
    expect(isScheduleDue(s, new Date("2026-06-30T13:00:00Z"))).toBe(true);
  });

  it("daily: does not resend the same day, resends the next", () => {
    const s = sched({
      enabled: true,
      frequency: "daily",
      hourUtc: 13,
      lastSentAt: new Date("2026-06-30T13:05:00Z"),
    });
    expect(isScheduleDue(s, new Date("2026-06-30T18:00:00Z"))).toBe(false); // already sent today
    expect(isScheduleDue(s, new Date("2026-07-01T13:00:00Z"))).toBe(true); // next day's instant
  });

  it("weekly: due on the configured weekday at/after the hour, once per week", () => {
    // 2026-06-29 is a Monday. dayOfWeek=1 (Mon), hour 13.
    const base = sched({ enabled: true, frequency: "weekly", dayOfWeek: 1, hourUtc: 13 });
    expect(isScheduleDue({ ...base, lastSentAt: null }, new Date("2026-06-29T12:00:00Z"))).toBe(false);
    expect(isScheduleDue({ ...base, lastSentAt: null }, new Date("2026-06-29T13:30:00Z"))).toBe(true);
    // Sent Monday → not due again Wednesday.
    const sent = { ...base, lastSentAt: new Date("2026-06-29T13:30:00Z") };
    expect(isScheduleDue(sent, new Date("2026-07-01T13:30:00Z"))).toBe(false);
    // …but due again the following Monday.
    expect(isScheduleDue(sent, new Date("2026-07-06T13:30:00Z"))).toBe(true);
  });

  it("monthly: due on the configured day of month, once per month", () => {
    const base = sched({ enabled: true, frequency: "monthly", dayOfMonth: 1, hourUtc: 13 });
    expect(isScheduleDue({ ...base, lastSentAt: null }, new Date("2026-06-01T13:00:00Z"))).toBe(true);
    const sent = { ...base, lastSentAt: new Date("2026-06-01T13:00:00Z") };
    expect(isScheduleDue(sent, new Date("2026-06-20T13:00:00Z"))).toBe(false);
    expect(isScheduleDue(sent, new Date("2026-07-01T13:00:00Z"))).toBe(true);
  });
});

describe("scheduledInstant", () => {
  it("monthly returns the current month's day at the configured hour", () => {
    const s = sched({ frequency: "monthly", dayOfMonth: 15, hourUtc: 9 });
    const inst = scheduledInstant(s, new Date("2026-01-20T00:00:00Z"));
    expect(inst?.toISOString()).toBe("2026-01-15T09:00:00.000Z");
  });

  it("weekly returns this week's occurrence (may be future before it arrives)", () => {
    // 2026-06-28 is a Sunday; target Monday(1).
    const s = sched({ frequency: "weekly", dayOfWeek: 1, hourUtc: 13 });
    const inst = scheduledInstant(s, new Date("2026-06-28T00:00:00Z"));
    expect(inst?.toISOString()).toBe("2026-06-29T13:00:00.000Z");
  });
});

describe("normalizeSchedule", () => {
  it("fills defaults and clamps out-of-range values", () => {
    const s = normalizeSchedule("weekly", {
      enabled: true,
      frequency: "bogus",
      hourUtc: 99,
      dayOfWeek: 9,
      recipients: null,
      lastSentAt: "not-a-date",
    });
    expect(s.frequency).toBe("weekly"); // bad frequency → default
    expect(s.hourUtc).toBe(23); // clamped
    expect(s.dayOfWeek).toBe(6); // clamped
    expect(s.recipients).toEqual([]);
    expect(s.lastSentAt).toBeNull();
  });
});

describe("recipient resolution", () => {
  it("dedupes case-insensitively and drops invalid", () => {
    expect(dedupeEmails(["A@x.com", "a@x.com", " b@x.com ", "nope", "", null])).toEqual([
      "A@x.com",
      "b@x.com",
    ]);
  });

  it("prefers explicit recipients, falls back to contacts", () => {
    expect(resolveRecipients(["owner@x.com"], ["fallback@x.com"])).toEqual(["owner@x.com"]);
    expect(resolveRecipients([], ["fallback@x.com", "fallback@x.com"])).toEqual(["fallback@x.com"]);
    expect(resolveRecipients([], [])).toEqual([]);
  });
});
