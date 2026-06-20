import { describe, expect, it } from "vitest";
import {
  hasPlannedShifts,
  isInPlannedShift,
  resolveShiftName,
  type ShiftPlanningContext,
} from "@/lib/metrics/shift";

// All timestamps in UTC so the wall-clock equals the instant (timeZone: "UTC").
const utc = (h: number, m = 0) => new Date(Date.UTC(2026, 5, 15, h, m)); // Mon 2026-06-15

const dayShift: ShiftPlanningContext = {
  timeZone: "UTC",
  shifts: [{ name: "Day", startTime: "08:00", endTime: "16:00" }],
  overrides: undefined,
};

const overnight: ShiftPlanningContext = {
  timeZone: "UTC",
  shifts: [{ name: "Night", startTime: "22:00", endTime: "06:00" }],
  overrides: undefined,
};

const empty: ShiftPlanningContext = { timeZone: "UTC", shifts: [], overrides: undefined };

describe("shift authority — the shift-aware-everywhere rule", () => {
  it("24/7 guard: an org with no usable shifts is always in-shift (never zeroes downtime)", () => {
    expect(hasPlannedShifts(empty)).toBe(false);
    expect(isInPlannedShift(empty, utc(3))).toBe(true);
    expect(isInPlannedShift(empty, utc(14))).toBe(true);
    // A schedule with only blank times is still "no usable shift" → 24/7.
    const blank: ShiftPlanningContext = {
      timeZone: "UTC",
      shifts: [{ name: "X", startTime: null, endTime: null }],
      overrides: undefined,
    };
    expect(hasPlannedShifts(blank)).toBe(false);
    expect(isInPlannedShift(blank, utc(3))).toBe(true);
  });

  it("day shift includes its window and excludes off-shift hours", () => {
    expect(hasPlannedShifts(dayShift)).toBe(true);
    expect(resolveShiftName(dayShift, utc(10))).toBe("Day");
    expect(isInPlannedShift(dayShift, utc(10))).toBe(true);
    expect(isInPlannedShift(dayShift, utc(8))).toBe(true); // inclusive start
    expect(isInPlannedShift(dayShift, utc(16))).toBe(false); // exclusive end
    expect(isInPlannedShift(dayShift, utc(20))).toBe(false);
    expect(resolveShiftName(dayShift, utc(20))).toBeNull();
  });

  it("overnight shift wraps midnight", () => {
    expect(isInPlannedShift(overnight, utc(23))).toBe(true);
    expect(isInPlannedShift(overnight, utc(2))).toBe(true);
    expect(isInPlannedShift(overnight, utc(12))).toBe(false);
  });

  it("disabled shifts do not count", () => {
    const disabled: ShiftPlanningContext = {
      timeZone: "UTC",
      shifts: [{ name: "Day", startTime: "08:00", endTime: "16:00", enabled: false }],
      overrides: undefined,
    };
    expect(hasPlannedShifts(disabled)).toBe(false); // → 24/7 guard
    expect(isInPlannedShift(disabled, utc(10))).toBe(true);
  });
});
