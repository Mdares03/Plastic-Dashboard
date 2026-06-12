/**
 * Accuracy report: edge counters vs dashboard counts (R1 / R3). Read-only.
 *
 * The client-facing proof that "the machine's own numbers" and "what the
 * dashboard shows" are the same number. For every work order it compares:
 *
 *   edge counter (R1)  MachineWorkOrder.good_parts / scrap_parts / cycle_count
 *                      — the lifetime totals the Pi maintains and shows on its
 *                      own home screen.
 *   dashboard sum (R2) Σ MachineCycle good/scrap deltas for that WO — what every
 *                      dashboard production number is built from.
 *
 * R3 invariant: these must agree. Any gap is surfaced here, never silently
 * resolved. DB uniqueness on MachineCycle(orgId,machineId,ts,cycleCount) means
 * the grouped sums are already deduped (= lib/metrics checkCounterDrift).
 *
 * Usage:
 *   node scripts/verify-edge-vs-dashboard.mjs [--orgId <id>] [--out <path.md>]
 * Default out: docs/verification/ACCURACY_REPORT_<YYYY-MM-DD>.md
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  if (i < 0) return null;
  const v = process.argv[i + 1];
  return !v || v.startsWith("--") ? null : v;
}
const orgId = argValue("--orgId");
const isoDate = new Date().toISOString().slice(0, 10);
const outPath = argValue("--out") ?? `docs/verification/ACCURACY_REPORT_${isoDate}.md`;
const trunc0 = (n) => Math.max(0, Math.trunc(Number(n) || 0));
const key = (machineId, workOrderId) => `${machineId}|${workOrderId}`;

async function main() {
  const orgs = orgId
    ? await prisma.org.findMany({ where: { id: orgId }, select: { id: true, name: true } })
    : await prisma.org.findMany({ select: { id: true, name: true } });

  const sections = [];
  let grandWos = 0;
  let grandWithDrift = 0;
  let grandCompleted = 0;

  for (const org of orgs) {
    const wos = await prisma.machineWorkOrder.findMany({
      where: { orgId: org.id },
      select: {
        machineId: true, workOrderId: true, sku: true, status: true,
        goodParts: true, scrapParts: true, cycleCount: true,
      },
    });
    if (wos.length === 0) continue;

    const cycleAgg = await prisma.machineCycle.groupBy({
      by: ["machineId", "workOrderId"],
      where: { orgId: org.id },
      _sum: { goodDelta: true, scrapDelta: true },
      _count: { _all: true },
    });
    const cycleMap = new Map();
    for (const row of cycleAgg) {
      if (!row.workOrderId) continue;
      cycleMap.set(key(row.machineId, row.workOrderId), {
        good: trunc0(row._sum.goodDelta),
        scrap: trunc0(row._sum.scrapDelta),
        rows: row._count._all,
      });
    }

    const rows = wos.map((wo) => {
      const cyc = cycleMap.get(key(wo.machineId, wo.workOrderId)) ?? { good: 0, scrap: 0, rows: 0 };
      const counterGood = trunc0(wo.goodParts);
      const counterScrap = trunc0(wo.scrapParts);
      const goodDrift = counterGood - cyc.good;
      const scrapDrift = counterScrap - cyc.scrap;
      // Good-parts agreement is the meaningful R3 production signal. Open WOs can
      // be off by a few in-flight cycles, so also track a 1%/±2-part tolerance.
      const goodExact = goodDrift === 0;
      const goodWithinTol = Math.abs(goodDrift) <= Math.max(2, counterGood * 0.01);
      return {
        workOrderId: wo.workOrderId, sku: wo.sku, status: wo.status,
        counterGood, cycleGood: cyc.good, goodDrift, goodExact, goodWithinTol,
        counterScrap, cycleScrap: cyc.scrap, scrapDrift,
      };
    });

    const completed = rows.filter((r) => String(r.status).toLowerCase() === "completed").length;
    const goodExactN = rows.filter((r) => r.goodExact).length;
    const goodTolN = rows.filter((r) => r.goodWithinTol).length;
    const scrapNeverPerCycle = rows.every((r) => r.cycleScrap === 0);
    grandWos += rows.length;
    grandWithDrift += rows.length - goodExactN;
    grandCompleted += completed;

    const exactPct = rows.length ? Math.round((goodExactN / rows.length) * 1000) / 10 : 100;
    const tolPct = rows.length ? Math.round((goodTolN / rows.length) * 1000) / 10 : 100;
    const worst = [...rows].sort((a, b) => Math.abs(b.goodDrift) - Math.abs(a.goodDrift)).slice(0, 15);
    const tableRows = worst
      .map(
        (r) =>
          `| ${r.workOrderId} | ${r.sku ?? "—"} | ${r.status} | ${r.counterGood} | ${r.cycleGood} | ${r.goodDrift} | ${r.goodExact ? "✅" : r.goodWithinTol ? "≈" : "⚠️"} |`,
      )
      .join("\n");

    sections.push(`## ${org.name}

- Work orders: **${rows.length}** (completed: ${completed}, open: ${rows.length - completed})
- Good-parts edge↔dashboard match: **${exactPct}% exact**, **${tolPct}% within ±1%** (${goodExactN}/${rows.length} exact)
${
  completed === 0
    ? `
> ⚠️ **0 completed work orders.** In the current edge flow WOs never transition to
> COMPLETED, so lifetime counters are still accumulating against open WOs — this is
> a point-in-time snapshot, not a closed-WO reconciliation. Small ±few-part gaps on
> RUNNING WOs are in-flight cycles; large gaps indicate missed cycle ingest. Both
> are addressed by edge reliability (Phase 6: transactional outbox + persistent
> context + WO close).
`
    : ""
}${
  scrapNeverPerCycle
    ? `
> ℹ️ **Scrap is not recorded per-cycle** in this deployment (\`Σ MachineCycle.scrapDelta = 0\`
> for every WO). Scrap lives in the WO counter (\`scrap_parts\`) and \`ReasonEntry\`, which is
> what the dashboard sums — so scrap is intentionally omitted from this counter-vs-cycle
> comparison rather than shown as a false disagreement. (Root-cause #5; data-model note.)
`
    : ""
}
| WO | SKU | Status | edge good | Σ cycle good | Δ | match |
|---|---|---|---:|---:|---:|:--:|
${tableRows || "| — | — | — | — | — | — | — |"}

_match: ✅ exact · ≈ within ±1% (in-flight) · ⚠️ gap > 1% (missed ingest)_`);
  }

  const grandMatchPct = grandWos ? Math.round(((grandWos - grandWithDrift) / grandWos) * 1000) / 10 : 100;
  const md = `# Accuracy report — edge counters vs dashboard counts

Generated ${new Date().toISOString()} · scope: ${orgId ? `org ${orgId}` : "all orgs"} · read-only

## Methodology
Each work order's **edge good-parts counter** (\`MachineWorkOrder.good_parts\` — the lifetime total the
Raspberry Pi maintains and shows on the machine's own screen, R1) is compared against the **dashboard
sum** (Σ of that WO's \`MachineCycle.goodDelta\`, R2 — the basis of every dashboard production number).
R3 says they must agree. Scrap is excluded (it is not recorded per-cycle here — see the per-org note).

## Summary
- Work orders compared: **${grandWos}** (completed: ${grandCompleted})
- Good-parts edge == dashboard (exact): **${grandMatchPct}%** (${grandWos - grandWithDrift}/${grandWos})
${grandCompleted === 0 ? "- ⚠️ **No completed work orders across any org** — WOs do not close in the current edge flow (Phase 6 item). This is a pre-Phase-6 BASELINE: gaps here are the target the edge-reliability work + go-live soak drive to ~100%.\n" : ""}
${sections.join("\n\n")}

---
_Reproduce: \`node scripts/verify-edge-vs-dashboard.mjs${orgId ? ` --orgId ${orgId}` : ""}\`. See \`docs/verification/ACCURACY_REPORT_TEMPLATE.md\` for how to read this report._
`;

  mkdirSync("docs/verification", { recursive: true });
  writeFileSync(outPath, md);
  console.log(`Accuracy report written: ${outPath}`);
  console.log(`WOs: ${grandWos} · match ${grandMatchPct}% · completed ${grandCompleted}`);
}

main()
  .catch((err) => {
    console.error("accuracy report failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
