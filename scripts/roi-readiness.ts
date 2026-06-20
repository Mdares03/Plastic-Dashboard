// TEMP read-only readiness check for the reliability-assurance loose ends. Safe to delete.
import { prisma } from "@/lib/prisma";

async function main() {
  const orgs = await prisma.org.findMany({ select: { id: true, name: true } });
  for (const o of orgs) {
    const [dtCats, dtItems, fin, shifts, settings, machines] = await Promise.all([
      prisma.reasonCatalogCategory.count({ where: { orgId: o.id, kind: "downtime" } }),
      prisma.reasonCatalogItem.count({ where: { orgId: o.id } }),
      prisma.orgFinancialProfile.findUnique({ where: { orgId: o.id }, select: { machineCostPerMin: true, operatorCostPerMin: true, defaultCurrency: true } }),
      prisma.orgShift.count({ where: { orgId: o.id, enabled: true } }),
      prisma.orgSettings.findUnique({ where: { orgId: o.id }, select: { defaultsJson: true } }),
      prisma.machine.count({ where: { orgId: o.id } }),
    ]);
    const roiCfg = (settings?.defaultsJson as Record<string, unknown> | null)?.roi ?? null;
    console.log(`\nORG  ${o.name}  (${o.id})`);
    console.log(`  machines:           ${machines}`);
    console.log(`  downtime catalog:   ${dtCats} categories / ${dtItems} items total`);
    console.log(`  financial profile:  machineCostPerMin=${fin?.machineCostPerMin ?? "—"} operatorCostPerMin=${fin?.operatorCostPerMin ?? "—"} currency=${fin?.defaultCurrency ?? "—"}`);
    console.log(`  enabled shifts:     ${shifts}`);
    console.log(`  ROI config:         ${roiCfg ? JSON.stringify(roiCfg) : "(none — defaults apply)"}`);
  }
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
