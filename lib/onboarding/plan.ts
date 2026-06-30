import { composeReasonCode } from "@/lib/reasonCatalogDb";
import type { OnboardingConfig } from "@/lib/onboarding/schema";

/**
 * Pure transform from a validated OnboardingConfig into the exact rows the
 * provision step writes, plus cross-row validation that a single-row Zod schema
 * can't express (duplicate machine names, colliding reasonCodes). Kept free of
 * Prisma I/O so it's unit-testable; provision.ts applies the plan in a tx.
 */

export type ProvisionReasonItem = {
  name: string;
  codeSuffix: string;
  reasonCode: string;
  sortOrder: number;
};

export type ProvisionReasonCategory = {
  kind: "downtime" | "scrap";
  name: string;
  codePrefix: string;
  planned: boolean;
  sortOrder: number;
  items: ProvisionReasonItem[];
};

export type ProvisionPlan = {
  org?: { name?: string; timezone?: string };
  financial?: OnboardingConfig["financial"];
  thresholds?: OnboardingConfig["thresholds"];
  machines: Array<{ name: string; code: string | null; location: string | null }>;
  shifts: Array<{ name: string; startTime: string; endTime: string; enabled: boolean; sortOrder: number }>;
  reasonCategories: ProvisionReasonCategory[];
  alertContacts: Array<{ name: string; roleScope: string; email: string | null; phone: string | null }>;
};

export type ProvisionPlanError = { path: string; message: string };

export type ProvisionCounts = {
  machines: number;
  shifts: number;
  reasonCategories: number;
  reasonItems: number;
  alertContacts: number;
  financial: boolean;
  thresholds: boolean;
  orgUpdated: boolean;
};

export function buildProvisionPlan(
  config: OnboardingConfig
): { plan: ProvisionPlan; errors: ProvisionPlanError[]; counts: ProvisionCounts } {
  const errors: ProvisionPlanError[] = [];

  // Machines — dedupe by case-insensitive name (matches the @@unique(orgId,name)),
  // keeping the last occurrence so a re-edit later in the file wins.
  const machineByKey = new Map<string, { name: string; code: string | null; location: string | null }>();
  (config.machines ?? []).forEach((m, idx) => {
    const key = m.name.trim().toLowerCase();
    if (machineByKey.has(key)) {
      errors.push({ path: `machines[${idx}]`, message: `Duplicate machine name "${m.name}"` });
    }
    machineByKey.set(key, {
      name: m.name.trim(),
      code: m.code?.trim() || null,
      location: m.location?.trim() || null,
    });
  });
  const machines = Array.from(machineByKey.values());

  // Shifts — sequential sortOrder mirrors the Settings shift writer.
  const shifts = (config.shifts ?? []).map((s, idx) => ({
    name: s.name.trim(),
    startTime: s.startTime,
    endTime: s.endTime,
    enabled: s.enabled !== false,
    sortOrder: idx + 1,
  }));

  // Reason catalog — derive reasonCode the same way the catalog routes do, and
  // reject collisions (the @@unique(orgId, reasonCode) would otherwise blow up
  // the whole transaction mid-write).
  const seenReasonCodes = new Map<string, string>();
  let reasonItemCount = 0;
  const reasonCategories: ProvisionReasonCategory[] = (config.reasonCategories ?? []).map((cat, ci) => {
    const items = (cat.items ?? []).map((it, ii) => {
      const reasonCode = composeReasonCode(cat.codePrefix, it.codeSuffix);
      const prior = seenReasonCodes.get(reasonCode);
      if (prior) {
        errors.push({
          path: `reasonCategories[${ci}].items[${ii}]`,
          message: `reasonCode ${reasonCode} collides with ${prior}`,
        });
      } else {
        seenReasonCodes.set(reasonCode, `reasonCategories[${ci}].items[${ii}]`);
      }
      reasonItemCount += 1;
      return { name: it.name.trim(), codeSuffix: it.codeSuffix.trim(), reasonCode, sortOrder: ii };
    });
    return {
      kind: cat.kind,
      name: cat.name.trim(),
      codePrefix: cat.codePrefix,
      planned: cat.planned === true,
      sortOrder: ci,
      items,
    };
  });

  // Alert contacts — dedupe by case-insensitive name (matches how a person maps
  // to one contact row); last occurrence wins.
  const contactByKey = new Map<string, { name: string; roleScope: string; email: string | null; phone: string | null }>();
  (config.alertContacts ?? []).forEach((c) => {
    contactByKey.set(c.name.trim().toLowerCase(), {
      name: c.name.trim(),
      roleScope: c.roleScope.trim(),
      email: c.email?.trim() || null,
      phone: c.phone?.trim() || null,
    });
  });
  const alertContacts = Array.from(contactByKey.values());

  const financialHasValue =
    !!config.financial && Object.values(config.financial).some((v) => v !== undefined);
  const thresholdsHasValue =
    !!config.thresholds && Object.values(config.thresholds).some((v) => v !== undefined);
  const orgHasValue = !!config.org && (config.org.name !== undefined || config.org.timezone !== undefined);

  const plan: ProvisionPlan = {
    org: orgHasValue ? config.org : undefined,
    financial: financialHasValue ? config.financial : undefined,
    thresholds: thresholdsHasValue ? config.thresholds : undefined,
    machines,
    shifts,
    reasonCategories,
    alertContacts,
  };

  const counts: ProvisionCounts = {
    machines: machines.length,
    shifts: shifts.length,
    reasonCategories: reasonCategories.length,
    reasonItems: reasonItemCount,
    alertContacts: alertContacts.length,
    financial: financialHasValue,
    thresholds: thresholdsHasValue,
    orgUpdated: orgHasValue,
  };

  return { plan, errors, counts };
}
