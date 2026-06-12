import { describe, expect, it } from "vitest";
import { MAX_OPEN_EPISODE_MS } from "@/lib/metrics";
import { MICROSTOP_MAX_SECONDS, classifyDowntimeCategory } from "@/lib/financial/impact";

// #13: financial downtime cost is re-based onto ReasonEntry (R5). ReasonEntry has
// no micro/macro flag, so the cosmetic split is by episode duration. The TOTAL
// cost congruence with the dashboard is proven separately by the read-only
// scripts/metrics/financial-rebase-check.ts exhibit (Δ=0 against prod).
describe("classifyDowntimeCategory — micro/macro split (#13)", () => {
  it("classifies below the threshold as microstop", () => {
    expect(classifyDowntimeCategory(0)).toBe("microstop");
    expect(classifyDowntimeCategory(MICROSTOP_MAX_SECONDS - 1)).toBe("microstop");
    expect(classifyDowntimeCategory(null)).toBe("microstop");
    expect(classifyDowntimeCategory(undefined)).toBe("microstop");
  });

  it("classifies at or above the threshold as macrostop", () => {
    expect(classifyDowntimeCategory(MICROSTOP_MAX_SECONDS)).toBe("macrostop");
    expect(classifyDowntimeCategory(3600)).toBe("macrostop");
  });

  it("caps a runaway episode at the 12h R5 ceiling but stays macrostop", () => {
    const overCap = MAX_OPEN_EPISODE_MS / 1000 + 100_000;
    expect(classifyDowntimeCategory(overCap)).toBe("macrostop");
  });

  it("clamps negative durations to microstop", () => {
    expect(classifyDowntimeCategory(-50)).toBe("microstop");
  });
});
