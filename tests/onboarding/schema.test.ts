import { describe, expect, it } from "vitest";
import {
  onboardingConfigSchema,
  onboardingContactSchema,
  onboardingShiftSchema,
  onboardingReasonCategorySchema,
} from "@/lib/onboarding/schema";

// Phase D (item 8): the ONE shared schema that the template, wizard, and import
// API all validate against. These lock the rules they all rely on.

describe("onboardingConfigSchema", () => {
  it("parses a full, valid payload and applies defaults", () => {
    const parsed = onboardingConfigSchema.parse({
      org: { name: "Acme", timezone: "America/Mexico_City" },
      financial: { defaultCurrency: "mxn", machineCostPerMin: 12.5, idleKw: "" },
      machines: [{ name: "Inj 1", code: "INJ-01" }],
      shifts: [{ name: "Morning", startTime: "06:00", endTime: "14:00" }],
      reasonCategories: [
        { kind: "downtime", name: "Mechanical", codePrefix: "mec", items: [{ name: "Mold change", codeSuffix: "01" }] },
      ],
      alertContacts: [{ name: "PM", roleScope: "plant_manager", email: "pm@example.com" }],
    });
    // codePrefix is upper-cased, blank numeric coerces to undefined, defaults fill in.
    expect(parsed.reasonCategories[0].codePrefix).toBe("MEC");
    expect(parsed.financial?.idleKw).toBeUndefined();
    expect(parsed.shifts[0].enabled).toBe(true);
    expect(parsed.reasonCategories[0].planned).toBe(false);
  });

  it("defaults array sections to empty when omitted", () => {
    const parsed = onboardingConfigSchema.parse({});
    expect(parsed.machines).toEqual([]);
    expect(parsed.shifts).toEqual([]);
    expect(parsed.reasonCategories).toEqual([]);
    expect(parsed.alertContacts).toEqual([]);
  });

  it("strips unknown top-level keys (e.g. the template _readme)", () => {
    const parsed = onboardingConfigSchema.parse({ _readme: ["hello"], machines: [{ name: "M1" }] });
    expect("_readme" in parsed).toBe(false);
    expect(parsed.machines[0].name).toBe("M1");
  });

  it("rejects an unknown nested key (typo guard)", () => {
    const res = onboardingConfigSchema.safeParse({ machines: [{ name: "M1", locaton: "x" }] });
    expect(res.success).toBe(false);
  });
});

describe("onboardingShiftSchema", () => {
  it("rejects a non HH:MM time", () => {
    expect(onboardingShiftSchema.safeParse({ name: "x", startTime: "6am", endTime: "14:00" }).success).toBe(false);
  });
  it("accepts a valid 24h time", () => {
    expect(onboardingShiftSchema.safeParse({ name: "x", startTime: "23:30", endTime: "07:15" }).success).toBe(true);
  });
});

describe("onboardingReasonCategorySchema", () => {
  it("rejects a non-numeric code suffix", () => {
    const res = onboardingReasonCategorySchema.safeParse({
      kind: "downtime",
      name: "Mech",
      codePrefix: "MEC",
      items: [{ name: "x", codeSuffix: "0A" }],
    });
    expect(res.success).toBe(false);
  });
  it("rejects a code prefix that does not start with a letter", () => {
    expect(
      onboardingReasonCategorySchema.safeParse({ kind: "downtime", name: "x", codePrefix: "1AB" }).success
    ).toBe(false);
  });
});

describe("onboardingContactSchema", () => {
  it("requires email or phone", () => {
    expect(onboardingContactSchema.safeParse({ name: "x", roleScope: "ops" }).success).toBe(false);
    expect(onboardingContactSchema.safeParse({ name: "x", roleScope: "ops", phone: "555" }).success).toBe(true);
  });
  it("rejects an invalid email", () => {
    expect(onboardingContactSchema.safeParse({ name: "x", roleScope: "ops", email: "nope" }).success).toBe(false);
  });
});
