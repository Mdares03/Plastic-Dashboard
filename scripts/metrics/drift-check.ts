/**
 * Read-only counter-drift check (R3) against whatever DATABASE_URL points at.
 *
 * Quantifies how far the edge-maintained MachineWorkOrder counters (R1) have
 * drifted from the sum of their MachineCycle deltas (R2) for every COMPLETED
 * work order. This is the "how dirty is prod" number that scopes Phase 2
 * cleanup, and the reconciliation exhibit for the trust report.
 *
 * Strictly read-only: only findMany / groupBy, never a write. Because the DB
 * enforces @@unique([orgId, machineId, ts, cycleCount]) on MachineCycle, the
 * groupBy sums equal the deduped delta sums that lib/metrics checkCounterDrift
 * computes — so we can aggregate in one query instead of pulling every row.
 *
 * Usage (point at prod via its env file):
 *   npm run drift:check
 *   # = dotenv -e .env.backup_prod_pointing -- tsx scripts/metrics/drift-check.ts
 *
 * Output: docs/verification/drift-<YYYY-MM-DD>.json  (+ a printed summary)
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { prisma } from "@/lib/prisma";
import type { CounterDrift } from "@/lib/metrics/types";

function isoDate(d: Date) {
  return d.toISOString().slice(0, 10);
}

const key = (orgId: string, machineId: string, workOrderId: string) =>
  `${orgId}|${machineId}|${workOrderId}`;

async function main() {
  // R1: completed work-order counters.
  const workOrders = await prisma.machineWorkOrder.findMany({
    where: { status: { equals: "COMPLETED", mode: "insensitive" } },
    select: {
      orgId: true,
      machineId: true,
      workOrderId: true,
      sku: true,
      goodParts: true,
      scrapParts: true,
      cycleCount: true,
    },
  });

  // R2: cycle-delta sums per (orgId, machineId, workOrderId). DB uniqueness on
  // (orgId, machineId, ts, cycleCount) means these sums are already deduped.
  const cycleAgg = await prisma.machineCycle.groupBy({
    by: ["orgId", "machineId", "workOrderId"],
    _sum: { goodDelta: true, scrapDelta: true },
    _count: { _all: true },
  });

  const cycleMap = new Map<string, { good: number; scrap: number; rows: number }>();
  for (const row of cycleAgg) {
    if (!row.workOrderId) continue;
    cycleMap.set(key(row.orgId, row.machineId, row.workOrderId), {
      good: row._sum.goodDelta ?? 0,
      scrap: row._sum.scrapDelta ?? 0,
      rows: row._count._all,
    });
  }

  const drifts: CounterDrift[] = workOrders.map((wo) => {
    const cyc = cycleMap.get(key(wo.orgId, wo.machineId, wo.workOrderId)) ?? {
      good: 0,
      scrap: 0,
      rows: 0,
    };
    const counterGood = Math.max(0, Math.trunc(wo.goodParts));
    const counterScrap = Math.max(0, Math.trunc(wo.scrapParts));
    const counterCycles = Math.max(0, Math.trunc(wo.cycleCount));
    const goodDrift = counterGood - cyc.good;
    const scrapDrift = counterScrap - cyc.scrap;
    const cycleDrift = counterCycles - cyc.rows;
    return {
      workOrderId: wo.workOrderId,
      counterGood,
      cycleGood: cyc.good,
      goodDrift,
      counterScrap,
      cycleScrap: cyc.scrap,
      scrapDrift,
      counterCycles,
      cycleRows: cyc.rows,
      cycleDrift,
      hasDrift: goodDrift !== 0 || scrapDrift !== 0 || cycleDrift !== 0,
    };
  });

  const withDrift = drifts.filter((d) => d.hasDrift);
  const absSum = (sel: (d: CounterDrift) => number) =>
    withDrift.reduce((acc, d) => acc + Math.abs(sel(d)), 0);

  const report = {
    capturedAt: new Date().toISOString(),
    database: "DATABASE_URL (redacted)",
    totals: {
      completedWorkOrders: drifts.length,
      workOrdersWithDrift: withDrift.length,
      driftRatePct:
        drifts.length > 0 ? Math.round((withDrift.length / drifts.length) * 1000) / 10 : 0,
      absGoodDrift: absSum((d) => d.goodDrift),
      absScrapDrift: absSum((d) => d.scrapDrift),
      absCycleDrift: absSum((d) => d.cycleDrift),
    },
    worstByGoodDrift: [...withDrift]
      .sort((a, b) => Math.abs(b.goodDrift) - Math.abs(a.goodDrift))
      .slice(0, 20),
  };

  mkdirSync("docs/verification", { recursive: true });
  const outPath = `docs/verification/drift-${isoDate(new Date())}.json`;
  writeFileSync(outPath, JSON.stringify(report, null, 2));

  console.log("=== R3 counter-drift check (read-only) ===");
  console.log(`Completed WOs:        ${report.totals.completedWorkOrders}`);
  console.log(`WOs with drift:       ${report.totals.workOrdersWithDrift} (${report.totals.driftRatePct}%)`);
  console.log(`|good| drift sum:     ${report.totals.absGoodDrift}`);
  console.log(`|scrap| drift sum:    ${report.totals.absScrapDrift}`);
  console.log(`|cycle| drift sum:    ${report.totals.absCycleDrift}`);
  console.log(`Report written:       ${outPath}`);
}

main()
  .catch((err) => {
    console.error("drift-check failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
