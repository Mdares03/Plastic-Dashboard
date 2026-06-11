import { describe, expect, it } from "vitest";
import {
  computeWindowRates,
  getLatestRates,
  getRateTrend,
  weightedRate,
} from "@/lib/metrics/rates";
import { at, kpi, MIN, T0 } from "../fixtures/scenario";

describe("R4 — rate authority (time-weighted)", () => {
  it("time-weights samples by span until the next sample", () => {
    const samples = [
      kpi({ ts: at(0), oee: 50 }),
      kpi({ ts: at(5 * MIN), oee: 100 }),
    ];
    // s1 span 5min, s2 span 5min (to windowEnd) → (50*5 + 100*5)/10 = 75
    expect(weightedRate(samples, "oee", at(10 * MIN))).toBe(75);
  });

  it("caps a single sample's weight at 10 min so a stale sample can't dominate", () => {
    const samples = [
      kpi({ ts: at(0), oee: 80 }), // span 30min → capped to 10min
      kpi({ ts: at(30 * MIN), oee: 20 }), // span 5min
    ];
    // capped: (80*10 + 20*5)/15 = 60  (uncapped would be 2500/35 ≈ 71.43)
    expect(weightedRate(samples, "oee", at(35 * MIN))).toBe(60);
  });

  it("excludes samples not in production (trackingEnabled && productionStarted)", () => {
    const samples = [
      kpi({ ts: at(0), oee: 50 }),
      kpi({ ts: at(5 * MIN), oee: 0, productionStarted: false }), // excluded
    ];
    // only s1 counts; its span runs to windowEnd → average is just 50
    expect(weightedRate(samples, "oee", at(10 * MIN))).toBe(50);
  });

  it("computes all four rates together", () => {
    const samples = [kpi({ ts: at(0), oee: 90, availability: 95, performance: 88, quality: 99 })];
    expect(computeWindowRates(samples, at(10 * MIN))).toEqual({
      oee: 90,
      availability: 95,
      performance: 88,
      quality: 99,
    });
  });
});

describe("R7 — null semantics", () => {
  it("returns null (not 0) when no eligible sample carries weight", () => {
    expect(weightedRate([], "oee", at(10 * MIN))).toBeNull();
    const onlyNonProduction = [kpi({ ts: at(0), oee: 100, trackingEnabled: false })];
    expect(weightedRate(onlyNonProduction, "oee", at(10 * MIN))).toBeNull();
  });

  it("getLatestRates returns the latest production snapshot only if fresh (<10min)", () => {
    const now = at(60 * MIN);
    const fresh = [kpi({ ts: at(55 * MIN), oee: 77 })];
    expect(getLatestRates(fresh, now).oee).toBe(77);

    const stale = [kpi({ ts: at(40 * MIN), oee: 77 })]; // 20min old → null
    expect(getLatestRates(stale, now)).toEqual({
      oee: null,
      availability: null,
      performance: null,
      quality: null,
    });
  });

  it("getRateTrend emits null buckets for gaps (never 0)", () => {
    // 3 buckets over 30min; only the first has a production sample.
    const samples = [kpi({ ts: at(1 * MIN), oee: 60 })];
    const trend = getRateTrend(samples, T0, at(30 * MIN), 3);
    expect(trend).toHaveLength(3);
    expect(trend[0].rates.oee).toBe(60);
    expect(trend[1].rates.oee).toBeNull(); // gap → null, not 0
    expect(trend[2].rates.oee).toBeNull();
  });
});
