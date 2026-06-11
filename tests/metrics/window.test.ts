import { describe, expect, it } from "vitest";
import { getLocalParts, resolveWindow } from "@/lib/metrics/window";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("R6 — window authority", () => {
  it("today is calendar midnight-to-midnight in UTC, not rolling", () => {
    const now = new Date("2026-06-11T15:00:00.000Z");
    const w = resolveWindow({ mode: "today", timezone: "UTC", now });
    expect(w.start.toISOString()).toBe("2026-06-11T00:00:00.000Z");
    expect(w.end.toISOString()).toBe("2026-06-12T00:00:00.000Z");
    expect(w.mode).toBe("today");
    expect(w.label).toBe("Hoy");
    expect(w.timezone).toBe("UTC");
  });

  it("yesterday is the prior calendar day", () => {
    const now = new Date("2026-06-11T15:00:00.000Z");
    const w = resolveWindow({ mode: "yesterday", timezone: "UTC", now });
    expect(w.start.toISOString()).toBe("2026-06-10T00:00:00.000Z");
    expect(w.end.toISOString()).toBe("2026-06-11T00:00:00.000Z");
    expect(w.label).toBe("Ayer");
  });

  it("anchors calendar days to LOCAL midnight in the org timezone", () => {
    const now = new Date("2026-06-11T15:00:00.000Z");
    const tz = "America/Mexico_City";
    const w = resolveWindow({ mode: "today", timezone: tz, now });
    const localStart = getLocalParts(w.start, tz);
    // start must be local 00:00, and the window must span exactly one day
    expect([localStart.hour, localStart.minute]).toEqual([0, 0]);
    expect(w.end.getTime() - w.start.getTime()).toBe(DAY_MS);
    // and "now" must fall inside today
    expect(w.start.getTime()).toBeLessThanOrEqual(now.getTime());
    expect(now.getTime()).toBeLessThan(w.end.getTime());
  });

  it("rolling windows end at now and carry a non-calendar label", () => {
    const now = new Date("2026-06-11T15:00:00.000Z");
    const w = resolveWindow({ mode: "7d", timezone: "UTC", now });
    expect(w.end.getTime()).toBe(now.getTime());
    expect(w.start.getTime()).toBe(now.getTime() - 7 * DAY_MS);
    expect(w.label).not.toMatch(/Hoy|Ayer/); // a rolling window may never be labeled Hoy/Ayer
  });

  it("echoes resolution metadata for custom windows", () => {
    const start = new Date("2026-06-01T00:00:00.000Z");
    const end = new Date("2026-06-02T00:00:00.000Z");
    const w = resolveWindow({ mode: "custom", timezone: "UTC", start, end });
    expect(w).toMatchObject({ start, end, mode: "custom", timezone: "UTC" });
  });

  // DST regression: a fixed ±24h step lands in the wrong calendar day on the two
  // transition days per year. Calendar days must stay whole regardless of 23h/25h.
  it("yesterday stays whole the day after spring-forward (23h yesterday)", () => {
    const tz = "America/New_York"; // DST began 2026-03-08
    const now = new Date("2026-03-09T15:00:00.000Z");
    const w = resolveWindow({ mode: "yesterday", timezone: tz, now });
    // yesterday = all of Mar 8 (EST midnight 05:00Z → EDT midnight 04:00Z, a 23h day)
    expect(w.start.toISOString()).toBe("2026-03-08T05:00:00.000Z");
    expect(w.end.toISOString()).toBe("2026-03-09T04:00:00.000Z");
  });

  it("today stays whole on the fall-back day (25h today)", () => {
    const tz = "America/New_York"; // DST ended 2026-11-01
    const now = new Date("2026-11-01T15:00:00.000Z");
    const w = resolveWindow({ mode: "today", timezone: tz, now });
    // today = all of Nov 1 (EDT midnight 04:00Z → EST midnight 05:00Z, a 25h day)
    expect(w.start.toISOString()).toBe("2026-11-01T04:00:00.000Z");
    expect(w.end.toISOString()).toBe("2026-11-02T05:00:00.000Z");
  });
});
