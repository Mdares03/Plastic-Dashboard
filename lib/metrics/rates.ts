/**
 * R4 (rate authority) + R7 (null semantics).
 *
 * Window rates are the time-weighted average of `MachineKpiSnapshot` rows in the
 * window, filtered to `trackingEnabled && productionStarted`, with each sample's
 * weight capped at MAX_SAMPLE_WEIGHT_MS so a gap can't let one stale sample
 * dominate. Extracted from lib/recap/getRecapData.ts:700 (`weightedAvg`), which
 * had the time-weighting but neither the filter nor the cap.
 *
 * Plain (unweighted) snapshot averages are forbidden everywhere (that was the
 * Reports path that disagreed with Recap). Missing data is null, never 0/100.
 */
import { CURRENT_RATE_MAX_AGE_MS, MAX_SAMPLE_WEIGHT_MS } from "./spec";
import type { KpiSample, RateField, RateSet } from "./types";

const RATE_FIELDS: RateField[] = ["oee", "availability", "performance", "quality"];

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function isProductionSample(s: KpiSample): boolean {
  return s.trackingEnabled === true && s.productionStarted === true;
}

/**
 * R4 — time-weighted window average for one field. `windowEnd` bounds the weight
 * of the last sample. Returns null when no eligible sample carries weight (R7).
 */
export function weightedRate(
  samples: KpiSample[],
  field: RateField,
  windowEnd: Date,
): number | null {
  const eligible = samples
    .filter(isProductionSample)
    .sort((a, b) => a.ts.getTime() - b.ts.getTime());
  if (!eligible.length) return null;

  const windowEndMs = windowEnd.getTime();
  let totalWeight = 0;
  let weightedSum = 0;
  for (let i = 0; i < eligible.length; i += 1) {
    const current = eligible[i];
    const value = current[field];
    if (value == null) continue;
    const nextTsMs = (eligible[i + 1]?.ts.getTime() ?? windowEndMs);
    const span = nextTsMs - current.ts.getTime();
    if (span <= 0) continue;
    const weight = Math.min(span, MAX_SAMPLE_WEIGHT_MS); // R4: cap a single sample's weight
    weightedSum += value * weight;
    totalWeight += weight;
  }
  return totalWeight > 0 ? round2(weightedSum / totalWeight) : null;
}

/** R4 — all four window rates at once. */
export function computeWindowRates(samples: KpiSample[], windowEnd: Date): RateSet {
  return {
    oee: weightedRate(samples, "oee", windowEnd),
    availability: weightedRate(samples, "availability", windowEnd),
    performance: weightedRate(samples, "performance", windowEnd),
    quality: weightedRate(samples, "quality", windowEnd),
  };
}

/**
 * R4 — "current" tiles: the latest production snapshot, but only if it is fresher
 * than CURRENT_RATE_MAX_AGE_MS. Otherwise every field is null (renders "—", R7) —
 * never a stale number presented as live.
 */
export function getLatestRates(samples: KpiSample[], now: Date): RateSet {
  const nullSet: RateSet = { oee: null, availability: null, performance: null, quality: null };
  const latest = samples
    .filter(isProductionSample)
    .reduce<KpiSample | null>(
      (best, s) => (best == null || s.ts.getTime() > best.ts.getTime() ? s : best),
      null,
    );
  if (!latest) return nullSet;
  if (now.getTime() - latest.ts.getTime() > CURRENT_RATE_MAX_AGE_MS) return nullSet;
  return {
    oee: latest.oee,
    availability: latest.availability,
    performance: latest.performance,
    quality: latest.quality,
  };
}

export type RateTrendBucket = {
  start: Date;
  end: Date;
  rates: RateSet;
};

/**
 * R4 + R7 — per-bucket time-weighted rates over evenly divided sub-windows.
 * A bucket with no qualifying samples yields a null RateSet (a *null gap*, not a
 * zero — zeros poison averages and fake collapses). Completes the half-deployed
 * oeeTrend fix.
 */
export function getRateTrend(
  samples: KpiSample[],
  windowStart: Date,
  windowEnd: Date,
  bucketCount: number,
): RateTrendBucket[] {
  const buckets: RateTrendBucket[] = [];
  if (bucketCount <= 0) return buckets;
  const startMs = windowStart.getTime();
  const totalMs = windowEnd.getTime() - startMs;
  if (totalMs <= 0) return buckets;
  const step = totalMs / bucketCount;

  for (let i = 0; i < bucketCount; i += 1) {
    const bStart = new Date(startMs + step * i);
    const bEnd = new Date(i === bucketCount - 1 ? windowEnd.getTime() : startMs + step * (i + 1));
    const inBucket = samples.filter(
      (s) => s.ts.getTime() >= bStart.getTime() && s.ts.getTime() < bEnd.getTime(),
    );
    const emptyOfProduction = !inBucket.some(isProductionSample);
    buckets.push({
      start: bStart,
      end: bEnd,
      rates: emptyOfProduction
        ? { oee: null, availability: null, performance: null, quality: null }
        : computeWindowRates(inBucket, bEnd),
    });
  }
  return buckets;
}

export { RATE_FIELDS };
