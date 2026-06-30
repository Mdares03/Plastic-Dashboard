import { describe, expect, it } from "vitest";
import { buildProvisionPlan } from "@/lib/onboarding/plan";
import { onboardingConfigSchema } from "@/lib/onboarding/schema";
import { buildOnboardingTemplate } from "@/lib/onboarding/template";

// buildProvisionPlan does the cross-row work a single-row schema can't: it derives
// reasonCodes the same way the catalog routes do, and catches duplicate machine
// names / colliding reasonCodes before they abort the import transaction.

function plan(input: unknown) {
  return buildProvisionPlan(onboardingConfigSchema.parse(input));
}

describe("buildProvisionPlan", () => {
  it("derives reasonCode = prefix + suffix and sets sortOrder", () => {
    const { plan: p, errors } = plan({
      reasonCategories: [
        { kind: "downtime", name: "Mech", codePrefix: "mec", items: [{ name: "Mold", codeSuffix: "01" }] },
      ],
    });
    expect(errors).toHaveLength(0);
    expect(p.reasonCategories[0].items[0].reasonCode).toBe("MEC-01");
    expect(p.reasonCategories[0].items[0].sortOrder).toBe(0);
  });

  it("flags duplicate machine names (case-insensitive) and keeps the last", () => {
    const { plan: p, errors } = plan({
      machines: [
        { name: "Inj 1", location: "A" },
        { name: "inj 1", location: "B" },
      ],
    });
    expect(errors.some((e) => /Duplicate machine/.test(e.message))).toBe(true);
    expect(p.machines).toHaveLength(1);
    expect(p.machines[0].location).toBe("B");
  });

  it("flags colliding reasonCodes across categories", () => {
    const { errors } = plan({
      reasonCategories: [
        { kind: "downtime", name: "A", codePrefix: "MEC", items: [{ name: "x", codeSuffix: "01" }] },
        { kind: "downtime", name: "B", codePrefix: "MEC", items: [{ name: "y", codeSuffix: "01" }] },
      ],
    });
    expect(errors.some((e) => /collides/.test(e.message))).toBe(true);
  });

  it("counts only sections that carry values", () => {
    const { counts } = plan({
      machines: [{ name: "M1" }, { name: "M2" }],
      financial: { machineCostPerMin: 10 },
    });
    expect(counts.machines).toBe(2);
    expect(counts.financial).toBe(true);
    expect(counts.thresholds).toBe(false);
    expect(counts.orgUpdated).toBe(false);
  });

  it("dedupes alert contacts by name", () => {
    const { plan: p } = plan({
      alertContacts: [
        { name: "PM", roleScope: "ops", email: "a@x.com" },
        { name: "pm", roleScope: "lead", phone: "555" },
      ],
    });
    expect(p.alertContacts).toHaveLength(1);
    expect(p.alertContacts[0].roleScope).toBe("lead");
  });
});

describe("template", () => {
  it("validates cleanly through the shared schema and builds without errors", () => {
    const parsed = onboardingConfigSchema.parse(buildOnboardingTemplate());
    const { errors, counts } = buildProvisionPlan(parsed);
    expect(errors).toHaveLength(0);
    expect(counts.machines).toBe(3);
    expect(counts.reasonItems).toBe(5);
  });
});
