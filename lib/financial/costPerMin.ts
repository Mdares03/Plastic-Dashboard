import { prisma } from "@/lib/prisma";

/**
 * Resolved cost per stopped minute (machine + operator + energy) for an org,
 * plus a `placeholder` flag. This is the SAME formula the ROI/financial pages
 * use (see lib/reports/roi.ts), extracted so any member-visible surface — e.g.
 * the Downtime page's "Est. cost" KPI — reports a consistent number without
 * needing the OWNER-only financial-config endpoint.
 *
 * `placeholder` is true when there is no profile, or the machine rate is still
 * the documented 1/min stub (docs/ROI_MODEL.md) — money is illustrative until a
 * real rate is entered.
 */
export async function resolveCostPerMin(
  orgId: string
): Promise<{ costPerMin: number; currency: string; placeholder: boolean }> {
  const p = await prisma.orgFinancialProfile.findUnique({ where: { orgId } });
  const machine = p?.machineCostPerMin ?? null;
  const operator = p?.operatorCostPerMin ?? 0;
  let energy = p?.energyCostPerMin ?? null;
  if (energy == null && p?.ratedRunningKw != null && p?.kwhRate != null) {
    energy = (p.ratedRunningKw / 60) * p.kwhRate * (p.energyMultiplier ?? 1);
  }
  const costPerMin = (machine ?? 0) + operator + (energy ?? 0);
  const placeholder = !p || machine == null || machine <= 1;
  return { costPerMin, currency: p?.defaultCurrency ?? "USD", placeholder };
}
