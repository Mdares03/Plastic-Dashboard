import { describe, expect, it } from "vitest";
import {
  checkCircuitBreaker,
  shouldNotifyIncident,
  type IncidentNotifyState,
} from "@/lib/alerts/throttle";

const T0 = new Date("2026-06-11T00:00:00.000Z");
const minsAfter = (n: number) => new Date(T0.getTime() + n * 60_000);

describe("alert throttle — per-incident dedup", () => {
  it("CEO-spam replay: N active pings of one incident → exactly ONE active send", () => {
    // The pilot scenario: the edge re-emits the same incident every minute for 3
    // days. With repeat off, only the first ping notifies; the rest are deduped.
    let state: IncidentNotifyState = { lastSentAt: null };
    let sends = 0;
    for (let minute = 0; minute < 3 * 24 * 60; minute += 1) {
      const send = shouldNotifyIncident({
        state,
        statusKey: "active",
        repeatMinutes: 0,
        now: minsAfter(minute),
      });
      if (send) {
        sends += 1;
        state = { lastSentAt: minsAfter(minute) };
      }
    }
    expect(sends).toBe(1);
  });

  it("resolved is one-and-done even if the resolved event repeats", () => {
    let state: IncidentNotifyState = { lastSentAt: null };
    let sends = 0;
    for (let i = 0; i < 10; i += 1) {
      const send = shouldNotifyIncident({ state, statusKey: "resolved", now: minsAfter(i) });
      if (send) {
        sends += 1;
        state = { lastSentAt: minsAfter(i) };
      }
    }
    expect(sends).toBe(1);
  });

  it("active repeats only after repeatMinutes elapse", () => {
    const state: IncidentNotifyState = { lastSentAt: T0 };
    // 10 min later, repeat=15 → not yet
    expect(
      shouldNotifyIncident({ state, statusKey: "active", repeatMinutes: 15, now: minsAfter(10) }),
    ).toBe(false);
    // 15 min later → re-notify
    expect(
      shouldNotifyIncident({ state, statusKey: "active", repeatMinutes: 15, now: minsAfter(15) }),
    ).toBe(true);
  });

  it("a never-sent incident always notifies (active and resolved)", () => {
    expect(
      shouldNotifyIncident({ state: { lastSentAt: null }, statusKey: "active", now: T0 }),
    ).toBe(true);
    expect(
      shouldNotifyIncident({ state: { lastSentAt: null }, statusKey: "resolved", now: T0 }),
    ).toBe(true);
  });
});

describe("alert throttle — circuit breaker", () => {
  const caps = { maxPerContactPerHour: 10, maxPerOrgPerHour: 60 };

  it("allows sends below both caps", () => {
    expect(
      checkCircuitBreaker({ contactSentLastHour: 3, orgSentLastHour: 20, ...caps }),
    ).toEqual({ allowed: true });
  });

  it("suppresses with org_cap when the org ceiling is hit (checked first)", () => {
    // 50 distinct incidents/hour: org cap (60) not yet hit at 60? hit at >=60.
    expect(
      checkCircuitBreaker({ contactSentLastHour: 5, orgSentLastHour: 60, ...caps }),
    ).toEqual({ allowed: false, reason: "org_cap" });
  });

  it("suppresses with contact_cap when only the contact ceiling is hit", () => {
    expect(
      checkCircuitBreaker({ contactSentLastHour: 10, orgSentLastHour: 12, ...caps }),
    ).toEqual({ allowed: false, reason: "contact_cap" });
  });

  it("a cap of 0 means unlimited for that dimension", () => {
    expect(
      checkCircuitBreaker({
        contactSentLastHour: 999,
        orgSentLastHour: 999,
        maxPerContactPerHour: 0,
        maxPerOrgPerHour: 0,
      }),
    ).toEqual({ allowed: true });
  });
});
