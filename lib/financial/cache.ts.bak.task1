import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";
import { computeFinancialImpact, type FinancialImpactParams } from "@/lib/financial/impact";

export const FINANCIAL_CONFIG_TTL_SEC = 15;
export const FINANCIAL_CONFIG_SWR_SEC = 45;
export const FINANCIAL_IMPACT_TTL_SEC = 10;
export const FINANCIAL_IMPACT_SWR_SEC = 30;

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
) {
  if (options?.refresh) {
    return computeFinancialImpact(params);
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
    () => computeFinancialImpact(params),
    keyParts,
    { revalidate: FINANCIAL_IMPACT_TTL_SEC, tags: [`financial-impact:${params.orgId}`] }
  );

  return cached();
}
