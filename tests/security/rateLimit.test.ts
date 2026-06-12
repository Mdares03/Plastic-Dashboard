import { beforeEach, describe, expect, it } from "vitest";
import {
  RATE_LIMITS,
  __resetRateLimitsForTest,
  checkRateLimit,
  getClientIp,
  rateLimit,
} from "@/lib/rateLimit";

beforeEach(() => {
  __resetRateLimitsForTest();
});

describe("rateLimit — fixed window", () => {
  it("allows exactly `limit` hits then blocks within the window", () => {
    const now = 1_000_000;
    for (let i = 1; i <= 5; i += 1) {
      const r = rateLimit("k", 5, 60_000, now);
      expect(r.ok).toBe(true);
      expect(r.remaining).toBe(5 - i);
    }
    const blocked = rateLimit("k", 5, 60_000, now);
    expect(blocked.ok).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSec).toBe(60);
  });

  it("resets after the window rolls over", () => {
    const start = 2_000_000;
    for (let i = 0; i < 5; i += 1) rateLimit("k", 5, 60_000, start);
    expect(rateLimit("k", 5, 60_000, start).ok).toBe(false);
    // one ms past the window end → fresh bucket
    const after = rateLimit("k", 5, 60_000, start + 60_001);
    expect(after.ok).toBe(true);
    expect(after.remaining).toBe(4);
  });

  it("keys are independent (different IPs / machines don't share a budget)", () => {
    const now = 3_000_000;
    for (let i = 0; i < 5; i += 1) rateLimit("a", 5, 60_000, now);
    expect(rateLimit("a", 5, 60_000, now).ok).toBe(false);
    expect(rateLimit("b", 5, 60_000, now).ok).toBe(true);
  });

  it("retryAfterSec rounds up and is never below 1 when blocked", () => {
    const now = 4_000_000;
    for (let i = 0; i < 5; i += 1) rateLimit("k", 5, 1_500, now);
    // 200ms into the window → 1300ms left → ceil = 2s
    const r = rateLimit("k", 5, 1_500, now + 200);
    expect(r.ok).toBe(false);
    expect(r.retryAfterSec).toBe(2);
  });
});

describe("checkRateLimit — named policies", () => {
  it("auth policy = 10/min, pair = 5/min, ingest = 600/min", () => {
    expect(RATE_LIMITS.auth).toEqual({ limit: 10, windowMs: 60_000 });
    expect(RATE_LIMITS.pair).toEqual({ limit: 5, windowMs: 60_000 });
    expect(RATE_LIMITS.ingest).toEqual({ limit: 600, windowMs: 60_000 });
  });

  it("namespaces by policy so a pair flood doesn't exhaust the auth budget", () => {
    const now = 5_000_000;
    for (let i = 0; i < 5; i += 1) checkRateLimit("pair", "1.2.3.4", now);
    expect(checkRateLimit("pair", "1.2.3.4", now).ok).toBe(false);
    // same identifier, different policy → unaffected
    expect(checkRateLimit("auth", "1.2.3.4", now).ok).toBe(true);
  });
});

describe("getClientIp", () => {
  const make = (headers: Record<string, string>) =>
    new Request("https://x.test", { headers });

  it("prefers the first x-forwarded-for entry", () => {
    expect(getClientIp(make({ "x-forwarded-for": "9.9.9.9, 10.0.0.1" }))).toBe("9.9.9.9");
  });

  it("falls back to x-real-ip, then 'unknown'", () => {
    expect(getClientIp(make({ "x-real-ip": "8.8.8.8" }))).toBe("8.8.8.8");
    expect(getClientIp(make({}))).toBe("unknown");
  });
});
