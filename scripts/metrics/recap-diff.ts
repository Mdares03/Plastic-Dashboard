/**
 * Phase 3 verification — field-level recap diff against a saved baseline.
 *
 * Recomputes computeRecap() for the same org/window grid the baseline capture
 * used (yesterday / rolling 7d / rolling 30d) and prints per-machine deltas for
 * the production / oee / downtime totals. Read-only.
 *
 * Diff baseline-2026-06-11.json (old recap code, clean data) vs current code to
 * isolate the R4/R5 migration delta:
 *   npx dotenv -e .env -- tsx scripts/metrics/recap-diff.ts docs/verification/baseline-2026-06-11.json
 */
import { readFileSync } from "node:fs";
import { prisma } from "@/lib/prisma";
import { computeRecap } from "@/lib/recap/getRecapData";

const baselinePath = process.argv[2];
if (!baselinePath) {
  console.error("usage: tsx scripts/metrics/recap-diff.ts <baseline.json>");
  process.exit(1);
}

const num = (v: unknown) => (typeof v === "number" ? v : null);
function delta(a: number | null, b: number | null) {
  if (a == null && b == null) return 0;
  return Math.round(((b ?? 0) - (a ?? 0)) * 100) / 100;
}

async function main() {
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));
  const rows: Record<string, unknown>[] = [];

  for (const org of baseline.orgs ?? []) {
    for (const win of org.windows ?? []) {
      const recapCap = (win.captures ?? []).find((c: { label: string }) => c.label === "recap");
      if (!recapCap?.ok) continue;
      const before = recapCap.data;
      const after = await computeRecap({
        orgId: org.orgId,
        start: new Date(win.from),
        end: new Date(win.to),
      });
      const beforeById = new Map(
        (before.machines ?? []).map((m: { machineId: string }) => [m.machineId, m]),
      );
      for (const am of after.machines) {
        const bm = beforeById.get(am.machineId) as any;
        if (!bm) continue;
        const dOee = delta(num(bm.oee?.avg), num(am.oee.avg));
        const dDown = delta(num(bm.downtime?.totalMin), num(am.downtime.totalMin));
        const dGood = delta(num(bm.production?.goodParts), num(am.production.goodParts));
        if (dOee === 0 && dDown === 0 && dGood === 0) continue;
        rows.push({
          window: win.window,
          machine: am.machineName,
          oee: `${bm.oee?.avg ?? "—"} → ${am.oee.avg ?? "—"} (${dOee >= 0 ? "+" : ""}${dOee})`,
          downtimeMin: `${bm.downtime?.totalMin ?? "—"} → ${am.downtime.totalMin} (${dDown >= 0 ? "+" : ""}${dDown})`,
          goodParts: `${bm.production?.goodParts ?? "—"} → ${am.production.goodParts} (${dGood >= 0 ? "+" : ""}${dGood})`,
        });
      }
    }
  }

  console.log(`Recap diff vs ${baselinePath} (changed rows only):`);
  console.table(rows);
  console.log(`${rows.length} machine×window cells changed.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
