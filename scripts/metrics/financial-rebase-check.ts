/**
 * Phase 7 (#13) verification — financial downtime cost re-based onto ReasonEntry.
 *
 * Proves the congruence claim: the minutes the financial module charges for
 * micro/macrostop downtime equal the dashboard's getDowntime (computeDowntime)
 * UNPLANNED minutes for the same org/window — because both now use the same
 * ReasonEntry rows + episodeWindowMinutes clamp (R5). Read-only.
 *
 *   npx dotenv -e .env -- tsx scripts/metrics/financial-rebase-check.ts [orgId] [days]
 */
import { prisma } from "@/lib/prisma";
import { computeFinancialImpact, MICROSTOP_MAX_SECONDS } from "@/lib/financial/impact";
import { computeDowntime, episodeWindowMinutes } from "@/lib/metrics";
import type { ResolvedWindow } from "@/lib/metrics/types";

const orgId = process.argv[2] ?? "7eae9e2d-1c88-41d7-9133-08887d54b395"; // BEMIS
const days = Number(process.argv[3] ?? 30);
const round2 = (n: number) => Math.round(n * 100) / 100;

async function main() {
  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000);

  const org = await prisma.org.findUnique({ where: { id: orgId }, select: { name: true } });
  const machines = await prisma.machine.findMany({ where: { orgId }, select: { id: true } });
  const machineIds = machines.map((m) => m.id);

  // Dashboard authority: same fetch + computeDowntime the recap grid uses.
  const reasons = await prisma.reasonEntry.findMany({
    where: { orgId, machineId: { in: machineIds }, kind: "downtime", capturedAt: { gte: start, lte: end } },
    select: {
      kind: true, reasonCode: true, reasonLabel: true, durationSeconds: true,
      capturedAt: true, episodeEndTs: true, scrapQty: true, workOrderId: true,
    },
  });
  const window: ResolvedWindow = { start, end, mode: "30d", timezone: "America/Mexico_City", label: `${days}d` };
  const dt = computeDowntime(reasons, window);

  // Hand-rolled unplanned minutes (independent of computeDowntime internals).
  const PLANNED = new Set(["MOLD_CHANGE"]);
  let unplannedMinManual = 0;
  for (const r of reasons) {
    if (PLANNED.has(String(r.reasonCode ?? "").trim().toUpperCase())) continue;
    unplannedMinManual += episodeWindowMinutes(r, start, end);
  }

  // Financial module (re-based): sum the minutes it actually charged for downtime.
  const fin = await computeFinancialImpact({ orgId, start, end, includeEvents: true });
  const downtimeDetails = fin.events.filter((e) => e.eventType === "downtime");
  const financialCostMinutes = downtimeDetails.reduce((acc, e) => acc + (e.durationSec ?? 0) / 60, 0);

  const totals = fin.currencySummaries.flatMap((s) => [
    `  ${s.currency}: total=${round2(s.totals.total)} micro=${round2(s.totals.microstop)} macro=${round2(s.totals.macrostop)} slow=${round2(s.totals.slowCycle)} scrap=${round2(s.totals.scrap)}`,
  ]);

  const deltaMin = round2(financialCostMinutes - unplannedMinManual);
  const congruent = Math.abs(deltaMin) < 0.5;

  const md = `# Phase 7 (#13) — financial downtime cost re-based onto ReasonEntry

Org: **${org?.name ?? orgId}** (\`${orgId}\`) · window: last ${days}d · generated ${new Date().toISOString()}

## Congruence proof (R5)
Financial downtime cost is now computed from the **same ReasonEntry rows + episodeWindowMinutes**
as the dashboard. So the minutes the financial module charges == the dashboard's UNPLANNED
downtime minutes. (Planned/MOLD_CHANGE downtime is excluded from cost — necessary, not a reducible loss.)

| Quantity | Minutes |
|---|---|
| computeDowntime totalMin (incl. planned) | ${dt.totalMin} |
| computeDowntime plannedMin | ${dt.plannedMin} |
| computeDowntime unplannedMin | ${dt.unplannedMin} |
| manual unplanned (independent recompute) | ${round2(unplannedMinManual)} |
| **financial downtime cost-minutes** | **${round2(financialCostMinutes)}** |
| Δ (financial − unplanned) | ${deltaMin} |

**Congruent: ${congruent ? "✅ YES" : "❌ NO"}** (|Δ| < 0.5 min)

## Financial totals (re-based)
${totals.join("\n")}

Downtime episodes charged: ${downtimeDetails.length} of ${reasons.length} ReasonEntry downtime rows
(difference = planned + zero-overlap + zero-cost episodes).

## Interpretation (vs the old event-sourced number)
Before #13, downtime cost was derived from \`MachineEvent\` micro/macrostop rows (with a 12h cap,
Phase 3 commit 3c343f6). That source silently **undercounted**: it skipped \`status:"active"\` and
duration-less stoppages, so the reported macrostop cost was far below the downtime the dashboard
actually showed. Re-basing onto ReasonEntry makes cost = (dashboard downtime minutes × idle rate),
so the financial page and the OEE/downtime views can no longer disagree.

Note micro ≈ 0: ReasonEntry holds operator/edge-classified downtime **episodes**, which are
overwhelmingly macro (>${MICROSTOP_MAX_SECONDS}s). Sub-minute microstops are a performance loss
captured by OEE/slow-cycle, not by the downtime authority — so they no longer appear as a separate
"microstop cost". This is the correct R5 behavior.
`;

  process.stdout.write(md);
  if (!congruent) process.exitCode = 1;
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
