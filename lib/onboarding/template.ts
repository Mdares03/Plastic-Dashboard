import type { OnboardingConfig } from "@/lib/onboarding/schema";

/**
 * The downloadable onboarding template (item 8). A worked example of the shared
 * schema shape so a new company can fill it in and upload it. The `_readme` key
 * is informational only — onboardingConfigSchema strips unknown top-level keys,
 * so it round-trips through the importer without error.
 *
 * JSON was chosen over xlsx for the template: the config is deeply nested
 * (categories → items, per-machine rows, financial block), which maps cleanly
 * to one JSON document and guarantees the template, the wizard, and the import
 * API all share exactly one schema. The on-screen wizard is the friendly path
 * for users who don't want to edit JSON.
 */

export type OnboardingTemplate = OnboardingConfig & { _readme?: string[] };

const README: string[] = [
  "MaliounTech — company onboarding template.",
  "Fill in the sections below and upload this file in Settings → Onboarding (or use the on-screen wizard).",
  "Every section is OPTIONAL: delete any block you don't need. Re-uploading updates existing rows (idempotent).",
  "machines: name is required and unique; code/location optional.",
  "shifts: startTime/endTime are HH:MM (24h). Uploading shifts REPLACES the current shift schedule.",
  "reasonCategories: kind is 'downtime' or 'scrap'; codePrefix starts with a letter; each item's codeSuffix is digits only. reasonCode = codePrefix + codeSuffix.",
  "financial: leave a value blank/omit it to keep the current setting. Costs are per-minute unless noted.",
  "alertContacts: each contact needs at least an email or a phone.",
];

export function buildOnboardingTemplate(): OnboardingTemplate {
  return {
    _readme: README,
    org: {
      name: "Acme Plastics — Plant 1",
      timezone: "America/Mexico_City",
    },
    financial: {
      defaultCurrency: "MXN",
      machineCostPerMin: 12.5,
      operatorCostPerMin: 4.0,
      ratedRunningKw: 30,
      idleKw: 5,
      kwhRate: 2.8,
      energyMultiplier: 1.0,
      scrapCostPerUnit: 1.75,
      rawMaterialCostPerUnit: 0.9,
    },
    machines: [
      { name: "Injection 1", code: "INJ-01", location: "Line A" },
      { name: "Injection 2", code: "INJ-02", location: "Line A" },
      { name: "Blow Molder 1", code: "BLW-01", location: "Line B" },
    ],
    shifts: [
      { name: "Morning", startTime: "06:00", endTime: "14:00", enabled: true },
      { name: "Evening", startTime: "14:00", endTime: "22:00", enabled: true },
      { name: "Night", startTime: "22:00", endTime: "06:00", enabled: true },
    ],
    reasonCategories: [
      {
        kind: "downtime",
        name: "Mechanical",
        codePrefix: "MEC",
        planned: false,
        items: [
          { name: "Mold change", codeSuffix: "01" },
          { name: "Hydraulic failure", codeSuffix: "02" },
        ],
      },
      {
        kind: "downtime",
        name: "Changeover (planned)",
        codePrefix: "CHG",
        planned: true,
        items: [{ name: "Product changeover", codeSuffix: "01" }],
      },
      {
        kind: "scrap",
        name: "Quality",
        codePrefix: "QLY",
        planned: false,
        items: [
          { name: "Short shot", codeSuffix: "01" },
          { name: "Contamination", codeSuffix: "02" },
        ],
      },
    ],
    thresholds: {
      stoppageMultiplier: 1.5,
      macroStoppageMultiplier: 5,
      oeeAlertThresholdPct: 90,
      performanceThresholdPct: 85,
      qualitySpikeDeltaPct: 5,
    },
    alertContacts: [
      { name: "Plant Manager", roleScope: "plant_manager", email: "manager@example.com", phone: "" },
      { name: "Maintenance Lead", roleScope: "maintenance", email: "maint@example.com", phone: "" },
    ],
  };
}

/** Pretty JSON string for the download endpoint. */
export function buildOnboardingTemplateJson(): string {
  return JSON.stringify(buildOnboardingTemplate(), null, 2);
}
