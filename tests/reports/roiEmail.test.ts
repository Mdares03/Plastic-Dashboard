import { describe, expect, it } from "vitest";
import { buildRoiSummaryEmail } from "@/lib/email";

const baseRoi = {
  baseline: { unplannedMinPerDay: 100 },
  current: { unplannedMinPerDay: 75 },
  targetReductionPct: 20,
  achievedReductionPct: 25,
  meetsTarget: true,
  estimatedMonthlySavings: 50000,
  currency: "MXN",
  costRatesArePlaceholder: false,
};

describe("buildRoiSummaryEmail (C5)", () => {
  it("reports reduction vs target and the money line when rates are real", () => {
    const email = buildRoiSummaryEmail({
      appName: "MIS",
      orgName: "Acme",
      roi: baseRoi,
      reportUrl: "https://x/reports/roi",
    });
    expect(email.subject).toContain("25.0%");
    expect(email.subject).toContain("≥20%");
    expect(email.text).toContain("on/above target");
    expect(email.text).toContain("MXN 50,000");
    expect(email.text).toContain("100 min/day → Current: 75 min/day");
  });

  it("never emails an illustrative money figure when rates are placeholders", () => {
    const email = buildRoiSummaryEmail({
      appName: "MIS",
      orgName: "Acme",
      roi: { ...baseRoi, costRatesArePlaceholder: true },
      reportUrl: "https://x/reports/roi",
    });
    expect(email.text).toContain("not shown (cost rates not configured");
    expect(email.text).not.toContain("MXN 50,000");
  });

  it("handles a missing baseline (no reduction computable)", () => {
    const email = buildRoiSummaryEmail({
      appName: "MIS",
      orgName: "Acme",
      roi: { ...baseRoi, achievedReductionPct: null, meetsTarget: false },
      reportUrl: "https://x/reports/roi",
    });
    expect(email.subject).toContain("—");
    expect(email.text).toContain("below target");
  });
});
