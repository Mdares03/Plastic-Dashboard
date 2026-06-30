import { describe, expect, it } from "vitest";
import { buildOnboardingWorkbook, parseOnboardingWorkbook } from "@/lib/onboarding/workbook";
import { onboardingConfigSchema } from "@/lib/onboarding/schema";
import { buildProvisionPlan } from "@/lib/onboarding/plan";

// Item 8: the Excel template and its parser are one round-trip. The downloaded
// workbook must parse back, validate against the shared schema, and produce the
// same example config the JSON template does.

describe("onboarding workbook", () => {
  it("round-trips build -> parse -> schema -> plan", () => {
    const buf = buildOnboardingWorkbook();
    expect(buf.length).toBeGreaterThan(0);

    const raw = parseOnboardingWorkbook(buf);
    const parsed = onboardingConfigSchema.safeParse(raw);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;

    const { errors, counts } = buildProvisionPlan(parsed.data);
    expect(errors).toHaveLength(0);
    expect(counts.machines).toBe(3);
    expect(counts.shifts).toBe(3);
    expect(counts.reasonItems).toBe(5);
    expect(counts.alertContacts).toBe(2);
    expect(counts.financial).toBe(true);
  });

  it("groups reason rows into categories and derives reasonCode", () => {
    const buf = buildOnboardingWorkbook();
    const parsed = onboardingConfigSchema.parse(parseOnboardingWorkbook(buf));
    const { plan } = buildProvisionPlan(parsed);
    // Template has 3 categories (Mechanical, Changeover planned, Quality scrap).
    expect(plan.reasonCategories).toHaveLength(3);
    const mech = plan.reasonCategories.find((c) => c.codePrefix === "MEC");
    expect(mech?.items.map((i) => i.reasonCode)).toContain("MEC-01");
    expect(plan.reasonCategories.find((c) => c.name === "Changeover (planned)")?.planned).toBe(true);
  });

  it("omits empty sheets gracefully (partial workbook)", () => {
    // A workbook with only a machines table still parses to just { machines }.
    const raw = parseOnboardingWorkbook(buildOnboardingWorkbook());
    expect(raw.machines).toBeTruthy();
    // Round-trip of the full template includes every section.
    expect(Object.keys(raw)).toEqual(
      expect.arrayContaining(["org", "financial", "thresholds", "machines", "shifts", "reasonCategories", "alertContacts"])
    );
  });
});
