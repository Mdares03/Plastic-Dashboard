import { z } from "zod";

/**
 * Phase D (item 8) — onboarding. ONE shared Zod schema that the three entry
 * points all validate against, so the downloadable template, the on-screen
 * wizard, and the import API can never drift apart:
 *   - lib/onboarding/template.ts  builds an example payload of this shape,
 *   - app/(app)/onboarding/*      collects the same shape in a wizard,
 *   - app/api/onboarding/import   parses an upload/wizard POST with this schema.
 *
 * Every section is optional so a company can be provisioned (or topped up)
 * incrementally — a payload with only `machines` is valid. The provision step
 * (lib/onboarding/provision.ts) upserts, so re-importing is idempotent.
 */

export const ONBOARDING_REASON_KINDS = ["downtime", "scrap"] as const;
export type OnboardingReasonKind = (typeof ONBOARDING_REASON_KINDS)[number];

// HH:MM 24h. Mirrors the shift inputs on Settings → Shifts.
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
// Same rule the reason-catalog category route enforces.
const CODE_PREFIX_RE = /^[A-Za-z][A-Za-z0-9-]*$/;

/** Empty string / null coerce to undefined so blank template cells are ignored. */
const optionalNumber = z.preprocess(
  (value) => {
    if (value === "" || value === null || value === undefined) return undefined;
    const n = Number(value);
    return Number.isFinite(n) ? n : value;
  },
  z.number().finite().nonnegative().optional()
);

const optionalText = (max: number) =>
  z.preprocess(
    (value) => {
      if (value === null || value === undefined) return undefined;
      const s = String(value).trim();
      return s === "" ? undefined : s;
    },
    z.string().max(max).optional()
  );

export const onboardingOrgSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    timezone: z.string().trim().min(1).max(64).optional(),
  })
  .strict();

export const onboardingFinancialSchema = z
  .object({
    defaultCurrency: optionalText(8),
    machineCostPerMin: optionalNumber,
    operatorCostPerMin: optionalNumber,
    ratedRunningKw: optionalNumber,
    idleKw: optionalNumber,
    kwhRate: optionalNumber,
    energyMultiplier: optionalNumber,
    scrapCostPerUnit: optionalNumber,
    rawMaterialCostPerUnit: optionalNumber,
  })
  .strict();

export const onboardingMachineSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    code: optionalText(40),
    location: optionalText(80),
  })
  .strict();

export const onboardingShiftSchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    startTime: z.string().trim().regex(TIME_RE, "Use HH:MM (24h)"),
    endTime: z.string().trim().regex(TIME_RE, "Use HH:MM (24h)"),
    enabled: z.boolean().optional().default(true),
  })
  .strict();

export const onboardingReasonItemSchema = z
  .object({
    name: z.string().trim().min(1).max(500),
    // The reason-catalog requires numeric suffixes; reasonCode = prefix + suffix.
    codeSuffix: z.string().trim().regex(/^\d+$/, "Digits only").max(32),
  })
  .strict();

export const onboardingReasonCategorySchema = z
  .object({
    kind: z.enum(ONBOARDING_REASON_KINDS),
    name: z.string().trim().min(1).max(200),
    codePrefix: z
      .string()
      .trim()
      .min(1)
      .max(32)
      .regex(CODE_PREFIX_RE, "Start with a letter; letters, digits, hyphen only")
      .transform((s) => s.toUpperCase()),
    // Planned categories (e.g. changeovers) are visible but excluded from the
    // reducible-loss / ROI denominator — see ReasonCatalogCategory.planned.
    planned: z.boolean().optional().default(false),
    items: z.array(onboardingReasonItemSchema).max(300).optional().default([]),
  })
  .strict();

export const onboardingThresholdsSchema = z
  .object({
    stoppageMultiplier: z.number().min(1.1).max(5).optional(),
    macroStoppageMultiplier: z.number().min(1.1).max(20).optional(),
    oeeAlertThresholdPct: z.number().min(50).max(100).optional(),
    performanceThresholdPct: z.number().min(50).max(100).optional(),
    qualitySpikeDeltaPct: z.number().min(0).max(100).optional(),
  })
  .strict();

export const onboardingContactSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    // Free-form scope label (e.g. "plant_manager", "maintenance"); matches AlertContact.roleScope.
    roleScope: z.string().trim().min(1).max(60),
    email: z.preprocess(
      (v) => {
        if (v === null || v === undefined) return undefined;
        const s = String(v).trim();
        return s === "" ? undefined : s;
      },
      z.string().email().max(200).optional()
    ),
    phone: optionalText(40),
  })
  .strict()
  .refine((c) => Boolean(c.email) || Boolean(c.phone), {
    message: "Each contact needs an email or a phone",
  });

/**
 * Top-level config. Unknown keys are stripped (not rejected) so the template's
 * `_readme` helper key and any future additive fields don't break an upload;
 * nested objects stay `.strict()` to catch field-name typos in a cell/header.
 */
export const onboardingConfigSchema = z.object({
  org: onboardingOrgSchema.optional(),
  financial: onboardingFinancialSchema.optional(),
  machines: z.array(onboardingMachineSchema).max(500).optional().default([]),
  shifts: z.array(onboardingShiftSchema).max(10).optional().default([]),
  reasonCategories: z.array(onboardingReasonCategorySchema).max(200).optional().default([]),
  thresholds: onboardingThresholdsSchema.optional(),
  alertContacts: z.array(onboardingContactSchema).max(200).optional().default([]),
});

export type OnboardingConfig = z.infer<typeof onboardingConfigSchema>;
export type OnboardingMachine = z.infer<typeof onboardingMachineSchema>;
export type OnboardingShift = z.infer<typeof onboardingShiftSchema>;
export type OnboardingReasonCategory = z.infer<typeof onboardingReasonCategorySchema>;
export type OnboardingContact = z.infer<typeof onboardingContactSchema>;
export type OnboardingFinancial = z.infer<typeof onboardingFinancialSchema>;
export type OnboardingThresholds = z.infer<typeof onboardingThresholdsSchema>;
