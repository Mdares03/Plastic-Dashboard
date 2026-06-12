import { NextResponse } from "next/server";

/**
 * In-process fixed-window rate limiter.
 *
 * LIMITATION (single instance): counters live in this Node process's memory.
 * With multiple server instances behind a load balancer each instance keeps
 * its own window, so the effective limit becomes (limit × instanceCount), and
 * a restart resets every window. This is acceptable for the current
 * single-instance deployment (documented in docs/SECURITY.md). Moving to a
 * multi-instance topology requires a shared store (e.g. Redis); the call sites
 * use the small surface below so only this file changes.
 */

export type RateLimitResult = {
  ok: boolean;
  limit: number;
  remaining: number;
  resetAt: number; // epoch ms when the current window ends
  retryAfterSec: number; // seconds until reset; 0 when ok
};

type Bucket = { count: number; resetAt: number };

// Named policies (limit = requests allowed per window).
export const RATE_LIMITS = {
  auth: { limit: 10, windowMs: 60_000 }, // login / signup / verify-email, keyed by IP
  pair: { limit: 5, windowMs: 60_000 }, // machine pairing, keyed by IP
  ingest: { limit: 600, windowMs: 60_000 }, // edge ingest, keyed by machineId
} as const;

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 50_000;

function sweep(now: number) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

/**
 * Record one hit against `key` and report whether it is within `limit` for the
 * current fixed window of `windowMs`. `now` is injectable for tests.
 */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
  now: number = Date.now()
): RateLimitResult {
  let bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    // Opportunistic cleanup so abandoned keys don't accumulate forever.
    if (buckets.size > MAX_BUCKETS) sweep(now);
    bucket = { count: 0, resetAt: now + windowMs };
    buckets.set(key, bucket);
  }

  bucket.count += 1;
  const ok = bucket.count <= limit;
  const remaining = Math.max(0, limit - bucket.count);
  const retryAfterSec = ok ? 0 : Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));

  return { ok, limit, remaining, resetAt: bucket.resetAt, retryAfterSec };
}

/** Convenience wrapper that applies one of the named RATE_LIMITS policies. */
export function checkRateLimit(
  policy: keyof typeof RATE_LIMITS,
  identifier: string,
  now: number = Date.now()
): RateLimitResult {
  const { limit, windowMs } = RATE_LIMITS[policy];
  return rateLimit(`${policy}:${identifier}`, limit, windowMs, now);
}

/** Standard 429 response carrying Retry-After + rate-limit headers. */
export function tooManyRequestsResponse(result: RateLimitResult) {
  return NextResponse.json(
    { ok: false, error: "Too many requests" },
    {
      status: 429,
      headers: {
        "Retry-After": String(result.retryAfterSec),
        "X-RateLimit-Limit": String(result.limit),
        "X-RateLimit-Remaining": String(result.remaining),
        "X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1000)),
      },
    }
  );
}

/** Best-effort client IP from proxy headers; falls back to a fixed bucket. */
export function getClientIp(req: Request): string {
  const xf = req.headers.get("x-forwarded-for");
  if (xf) {
    const first = xf.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

/** Test-only: reset all windows. */
export function __resetRateLimitsForTest() {
  buckets.clear();
}
