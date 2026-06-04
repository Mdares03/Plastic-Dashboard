import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";
import type { FinancialImpactParams, FinancialImpactResult } from "@/lib/financial/impact";
import {
  compileFinancialExpression,
  FINANCIAL_FORMULA_DEFAULTS,
  FINANCIAL_FORMULA_KEYS,
  pickFormulaExpression,
  type CompiledFinancialExpression,
  type FinancialFormulaKey,
} from "@/lib/financial/formulas";
import {
  createSchemaDriftDiagnostic,
  getMissingColumnName,
  isPrismaMissingColumnError,
  logFinancialSchemaDrift,
} from "@/lib/financial/diagnostics";

export const FINANCIAL_CONFIG_TTL_SEC = 15;
export const FINANCIAL_CONFIG_SWR_SEC = 45;
export const FINANCIAL_IMPACT_TTL_SEC = 10;
export const FINANCIAL_IMPACT_SWR_SEC = 30;

type CompiledFormulaSet = Partial<Record<FinancialFormulaKey, CompiledFinancialExpression>>;

const financialFormulaCache = new Map<string, { signature: string; formulas: CompiledFormulaSet }>();

function formulaSignature(formulasJson: unknown) {
  try {
    return JSON.stringify(formulasJson ?? null) ?? "null";
  } catch {
    return "null";
  }
}

function emptyImpact(params: FinancialImpactParams, message: string): FinancialImpactResult {
  return {
    range: { start: params.start, end: params.end },
    currencySummaries: [],
    eventsEvaluated: 0,
    eventsIncluded: 0,
    events: [],
    diagnostic: createSchemaDriftDiagnostic(message),
    filters: {
      machineId: params.machineId,
      location: params.location,
      sku: params.sku,
      currency: params.currency,
    },
  };
}

export function getCompiledFinancialFormulas(orgId: string, formulasJson: unknown): CompiledFormulaSet {
  const signature = formulaSignature(formulasJson);
  const cached = financialFormulaCache.get(orgId);
  if (cached && cached.signature === signature) {
    return cached.formulas;
  }

  const formulasRecord =
    formulasJson && typeof formulasJson === "object" && !Array.isArray(formulasJson)
      ? (formulasJson as Record<string, unknown>)
      : null;

  const formulas: CompiledFormulaSet = {};
  for (const key of FINANCIAL_FORMULA_KEYS) {
    const rawExpression = pickFormulaExpression(formulasRecord, key);
    try {
      formulas[key] = compileFinancialExpression(rawExpression);
    } catch {
      formulas[key] = compileFinancialExpression(FINANCIAL_FORMULA_DEFAULTS[key]);
    }
  }

  financialFormulaCache.set(orgId, { signature, formulas });
  return formulas;
}

async function loadFinancialConfig(orgId: string) {
  const [org, locations, machines, products] = await Promise.all([
    prisma.orgFinancialProfile.findUnique({ where: { orgId } }),
    prisma.locationFinancialOverride.findMany({ where: { orgId }, orderBy: { location: "asc" } }),
    prisma.machineFinancialOverride.findMany({ where: { orgId }, orderBy: { createdAt: "desc" } }),
    prisma.productCostOverride.findMany({ where: { orgId }, orderBy: { sku: "asc" } }),
  ]);

  return { org, locations, machines, products };
}

export type FinancialConfigPayload = Awaited<ReturnType<typeof loadFinancialConfig>>;

export async function getFinancialConfig(orgId: string, options?: { refresh?: boolean }) {
  if (options?.refresh) {
    return loadFinancialConfig(orgId);
  }

  const cached = unstable_cache(
    () => loadFinancialConfig(orgId),
    ["financial-config", orgId],
    { revalidate: FINANCIAL_CONFIG_TTL_SEC, tags: [`financial-config:${orgId}`] }
  );
  return cached();
}

export async function getFinancialImpactCached(
  params: FinancialImpactParams,
  options?: { refresh?: boolean }
): Promise<FinancialImpactResult> {
  const runImpact = async () => {
    const { computeFinancialImpact } = await import("@/lib/financial/impact");
    return computeFinancialImpact(params);
  };

  const runImpactSafe = async () => {
    try {
      return await runImpact();
    } catch (error) {
      if (!isPrismaMissingColumnError(error)) throw error;
      logFinancialSchemaDrift({
        route: "getFinancialImpactCached",
        orgId: params.orgId,
        error,
      });
      return emptyImpact(params, getMissingColumnName(error) ?? "unknown_column");
    }
  };

  if (options?.refresh) {
    return runImpactSafe();
  }

  const keyParts = [
    "financial-impact",
    params.orgId,
    String(params.start.getTime()),
    String(params.end.getTime()),
    params.machineId ?? "",
    params.location ?? "",
    params.sku ?? "",
    params.currency ?? "",
    params.includeEvents ? "1" : "0",
  ];

  const cached = unstable_cache(
    () => runImpactSafe(),
    keyParts,
    { revalidate: FINANCIAL_IMPACT_TTL_SEC, tags: [`financial-impact:${params.orgId}`] }
  );

  return cached();
}
