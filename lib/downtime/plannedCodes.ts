import { prisma } from "@/lib/prisma";
import { DEFAULT_PLANNED_CODES } from "@/lib/metrics";

/**
 * Resolve the set of reason codes that count as PLANNED downtime for an org.
 *
 * "Planned" is a per-org property: any active downtime reason in a category flagged
 * `planned` (e.g. BEMIS's DTPLN "Planeado" category — changeovers, no-program). The legacy
 * literal `MOLD_CHANGE` is always included for back-compat with orgs that never set the flag.
 *
 * Every computeDowntime caller (recap, financial, roi, health) passes this set so the
 * planned-vs-unplanned split — and therefore the ROI denominator — is consistent everywhere.
 */
export async function getPlannedReasonCodes(orgId: string): Promise<Set<string>> {
  const set = new Set<string>(DEFAULT_PLANNED_CODES);
  const items = await prisma.reasonCatalogItem.findMany({
    where: {
      orgId,
      active: true,
      category: { kind: "downtime", planned: true, active: true },
    },
    select: { reasonCode: true },
  });
  for (const it of items) {
    const code = String(it.reasonCode ?? "").trim().toUpperCase();
    if (code) set.add(code);
  }
  return set;
}
