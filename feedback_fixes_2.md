Handoff — MIS Control Tower (CT-side scope)
Date: 2026-05-15
Owner: Marcelo (MALIOUNTECH)
Repo: /home/mdares/mis-control-tower
Org ID: 6d2abda2-88e8-4d1d-8f2b-85e2e0d973e5
Out of scope: Pi-side work (speaker beeps, Node-RED catalog normalizer cleanup, Paro micro/macro merge) — tracked in a separate Pi handoff.

Status — what's already shipped

Anomaly Alert template (Pi) emits resolved downtime labels via numpad lookup — new entries are clean.
Home Template (Pi) emits resolved scrap labels via MX numpad — operator types digits, Pi resolves against local catalog.
Apply settings + update UI (Pi) now preserves reasonCode, prefix, and active when normalizing the catalog from CT — so the dashboard can do lookups.
Recap card already shows WO, SKU, Mold (mold parity from earlier WI-1 closed).

What's left on CT is data hygiene + card polish + one data-source bug.

Sequence

WI-A — Backfill downtime reasons (do first, you have CT access)
WI-B — Card improvements (theoretical cycle time, drop duplicate WO, Machines tab parity)
WI-C — Scrap source-of-truth fix (recap aggregation)
WI-D — Render-time downtime label resolver (optional, after WI-A is verified)


WI-A — Backfill historical downtime reasons
Problem
Rows like Procesos > 13, Mantenimiento > 08 exist in ReasonEntry from before the Pi-side numpad fix. The category label is preserved but detailLabel is the raw operator-typed number. New entries are clean post-fix; only historical rows need rewriting.
Step 1 — Find the catalog storage column
bashDATABASE_URL=$(sudo grep '^DATABASE_URL=' /etc/mis-control-tower.env | cut -d= -f2- | tr -d '"' | sed 's/[?&].*//')

# Find tables that might hold catalogs
psql "$DATABASE_URL" -c "\dt" | grep -iE "setting|catalog|reason|org"

# Inspect the likely table (adjust name)
psql "$DATABASE_URL" -c "\d \"OrgSettings\""

# Confirm it contains scrap + downtime entries
psql "$DATABASE_URL" -c "SELECT \"reasonCatalogJson\" FROM \"OrgSettings\" WHERE \"orgId\"='6d2abda2-88e8-4d1d-8f2b-85e2e0d973e5';" | head -50
Lock in the column name. Plug it into the loadCatalog function in the script below.
Step 2 — Count broken rows + backup
bashpsql "$DATABASE_URL" -c "
  SELECT COUNT(*) AS broken
  FROM \"ReasonEntry\"
  WHERE kind='downtime' AND \"detailLabel\" ~ '^[0-9]+$';
"

# Backup
pg_dump "$DATABASE_URL" -t '\"ReasonEntry\"' > /tmp/reasonentry-pre-backfill-$(date +%F).sql
ls -lh /tmp/reasonentry-pre-backfill-*.sql
Step 3 — Drop in the script
Create scripts/backfill-downtime-reasons.ts:
typescript// scripts/backfill-downtime-reasons.ts
//
// Usage:
//   npx tsx scripts/backfill-downtime-reasons.ts <orgId> --dry
//   npx tsx scripts/backfill-downtime-reasons.ts <orgId> --apply

import { prisma } from "@/lib/prisma";
import { normalizeReasonCatalog } from "@/lib/reasonCatalog";

const orgId = process.argv[2];
const mode = process.argv[3] || "--dry";
if (!orgId) { console.error("usage: <orgId> --dry|--apply"); process.exit(1); }

async function loadCatalog(orgId: string) {
  // ⚠️ Adjust table/column to match what you found in Step 1
  const row = await prisma.orgSettings.findUnique({
    where: { orgId },
    select: { reasonCatalogJson: true } as any,
  });
  return normalizeReasonCatalog((row as any)?.reasonCatalogJson);
}

(async () => {
  const catalog = await loadCatalog(orgId);
  if (!catalog) throw new Error("Catalog not found for orgId");

  const rows = await prisma.reasonEntry.findMany({
    where: { orgId, kind: "downtime" },
    select: {
      id: true, categoryId: true, categoryLabel: true,
      detailId: true, detailLabel: true, reasonCode: true, reasonLabel: true,
    },
  });

  let fixable = 0, skipped = 0, applied = 0, noMatch = 0;

  for (const row of rows) {
    const isBroken = /^\d{1,3}$/.test(row.detailLabel || "") || (row.detailLabel === row.reasonCode);
    if (!isBroken) { skipped++; continue; }

    const category = (catalog.downtime || []).find((c: any) =>
      c.id === row.categoryId ||
      c.label?.toLowerCase() === row.categoryLabel?.toLowerCase()
    );
    if (!category) { noMatch++; continue; }

    const digits = String(row.reasonCode || row.detailLabel || "").replace(/\D/g, "").padStart(2, "0");
    const details = (category as any).details || (category as any).children || [];
    const detail = details.find((d: any) => {
      const rc = String(d.reasonCode || "").toUpperCase();
      if (rc && rc.endsWith(digits)) return true;
      if (String(d.id || "").replace(/\D/g, "") === digits.replace(/^0+/, "")) return true;
      return false;
    });
    if (!detail) { noMatch++; continue; }

    const newCode = String(detail.reasonCode || `${(category as any).prefix || ""}${digits}`).toUpperCase();
    const newDetailLabel = detail.label;
    const newReasonLabel = `${category.label} > ${detail.label}`;

    console.log(`[${row.id}]  "${row.categoryLabel} > ${row.detailLabel}" (${row.reasonCode})  ->  "${newReasonLabel}" (${newCode})`);
    fixable++;

    if (mode === "--apply") {
      await prisma.reasonEntry.update({
        where: { id: row.id },
        data: {
          detailId: detail.id,
          detailLabel: newDetailLabel,
          reasonCode: newCode,
          reasonLabel: newReasonLabel,
        },
      });
      applied++;
    }
  }

  console.log(`\nfixable: ${fixable}  no-match: ${noMatch}  skipped: ${skipped}  applied: ${applied}  total: ${rows.length}`);
})().catch((e) => { console.error(e); process.exit(1); });
Step 4 — Dry-run, review, apply
bashcd /home/mdares/mis-control-tower

npx tsx scripts/backfill-downtime-reasons.ts 6d2abda2-88e8-4d1d-8f2b-85e2e0d973e5 --dry | tee /tmp/backfill-dry.log
Read the log. Spot-check at least 5 mappings against your printed reason catalog. If no-match count is high, the catalog/category matching is off — fix the script before applying.
bashnpx tsx scripts/backfill-downtime-reasons.ts 6d2abda2-88e8-4d1d-8f2b-85e2e0d973e5 --apply | tee /tmp/backfill-apply.log
Step 5 — Verify
bashpsql "$DATABASE_URL" -c "
  SELECT \"reasonCode\", \"categoryLabel\", \"detailLabel\", \"reasonLabel\", \"capturedAt\"
  FROM \"ReasonEntry\"
  WHERE kind='downtime' AND \"detailLabel\" ~ '^[0-9]+\$'
  LIMIT 20;
"
# Should return 0 rows, or only rows with no matching catalog entry (rare edge cases).
Refresh the Reports page → Procesos > 13 should now read Procesos > Falla hidráulica (or whatever real label).
Edge case: rows with empty categoryLabel and reasonCode = "DTPRC-01"
The screenshot shows a row like >  DTPRC-01. Backfill script skips these because there's no category to match. Manual SQL fix once you confirm what category DTPRC-01 belongs to — likely "Procesos". Investigate where these rows came from before patching, since something other than the operator HMI emitted them.
Acceptance

Zero rows match detailLabel ~ '^[0-9]+$' after apply (or only true edge cases logged as no-match).
Reports page renders real labels.
Backup file kept for at least 30 days.


WI-B — Card improvements
B1: Recap card — add theoretical cycle time, drop duplicate WO
Files

lib/recap/types.ts
lib/recap/getRecapData.ts
components/recap/RecapMachineCard.tsx
lib/i18n/en.json and lib/i18n/es.json

Changes
lib/recap/types.ts — extend RecapSummaryMachine:
typescriptexport type RecapSummaryMachine = {
  // ... existing fields
  cycleTime: number | null;  // seconds, theoretical from active WO / latest KPI snapshot
};
lib/recap/getRecapData.ts — in the per-machine summary build (near where goodParts/scrap are emitted), surface cycleTime. Source priority:

Active WO's cycleTime (most authoritative — operator-set per WO)
Latest MachineKpiSnapshot.cycleTime (fallback)
null if neither available

typescriptconst activeWo = /* however active WO is resolved */;
const cycleTime =
  activeWo?.cycleTime ??
  latestKpi?.cycleTime ??
  null;

return {
  // ... existing fields
  cycleTime,
};
components/recap/RecapMachineCard.tsx — find the metrics row:
tsx<div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-300">
  <span>{t("recap.card.good")}: {machine.goodParts}</span>
  <span>{t("recap.card.scrap")}: {machine.scrap}</span>
  <span>{t("recap.card.stops")}: {machine.stopsCount}</span>
</div>
Add the cycle-time span:
tsx<div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-300">
  <span>{t("recap.card.good")}: {machine.goodParts}</span>
  <span>{t("recap.card.scrap")}: {machine.scrap}</span>
  <span>{t("recap.card.stops")}: {machine.stopsCount}</span>
  <span>{t("recap.card.cycleTime")}: {machine.cycleTime != null ? `${machine.cycleTime.toFixed(1)}s` : "—"}</span>
</div>
Drop duplicate WO from footer. Find:
tsxconst footerText = machine.activeWorkOrderId
    ? t("recap.card.activeWorkOrder", { id: machine.activeWorkOrderId })
    : lastSeenLabel;
Change to:
tsxconst footerText = lastSeenLabel;
And in the footer JSX, find:
tsx{isUrgent
  ? t("recap.card.stoppedFor", { min: ongoingStopMin })
      + (machine.activeWorkOrderId ? ` · WO ${machine.activeWorkOrderId}` : "")
  : machine.status === "idle"
  ? t("recap.card.idle")
  : footerText}
Remove the  · WO ${machine.activeWorkOrderId} suffix from the urgent branch. WO is already shown in the dedicated metrics row.
i18n keys. Add to both en.json and es.json:

recap.card.cycleTime: "Ciclo std" (es) / "Std cycle" (en)

B2: Machines tab card — parity with Recap
Currently MachinesClient.tsx cards show only status, code, last-seen, and stopped-for. Goal: match Recap card content using WO running totals (not 24h windowed).
Files

lib/machines/withLatest.ts (or wherever the merge happens)
app/api/machines/route.ts
app/machines/MachinesClient.tsx
Reuse i18n keys from B1

Changes
API: surface active WO + KPI fields on the machines list.
/api/machines currently returns id, name, code, location, latestHeartbeat, latestMacrostop. Extend to also include the active work order + KPI snapshot:
typescript// In whichever route handler builds the response (likely app/api/machines/route.ts)
machine: {
  ...baseFields,
  latestHeartbeat,
  latestMacrostop,
  activeWorkOrder: {
    id: activeWo?.id ?? null,
    sku: activeWo?.sku ?? null,
    mold: activeWo?.mold ?? null,
    cycleTime: activeWo?.cycleTime ?? null,
    goodParts: activeWo?.goodParts ?? 0,
    scrapParts: activeWo?.scrapParts ?? 0,
    target: activeWo?.target ?? 0,
  },
  stopsCount: /* count of macrostops + microstops for this WO */,
  oee: latestKpi?.oee ?? null,
}
If you already wire latestKpi through mergeMachineOverviewRows, the additions are mostly type-level.
MachinesClient.tsx — extend MachineRow:
typescripttype MachineRow = {
  id: string;
  name: string;
  code?: string | null;
  location?: string | null;
  latestHeartbeat: /* existing */;
  latestMacrostop?: /* existing */;
  activeWorkOrder?: {
    id: string | null;
    sku: string | null;
    mold: string | null;
    cycleTime: number | null;
    goodParts: number;
    scrapParts: number;
    target: number;
  };
  stopsCount?: number;
  oee?: number | null;
};
In the card render, after the status block, add a metrics section mirroring the Recap card:
tsx{m.activeWorkOrder?.id && (
  <>
    <div className="mt-3 text-xs text-zinc-400">
      WO: {m.activeWorkOrder.id}
      {m.activeWorkOrder.sku ? ` · SKU: ${m.activeWorkOrder.sku}` : ""}
      {m.activeWorkOrder.mold ? ` · Molde: ${m.activeWorkOrder.mold}` : ""}
    </div>
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-300">
      <span>{t("recap.card.good")}: {m.activeWorkOrder.goodParts}</span>
      <span>{t("recap.card.scrap")}: {m.activeWorkOrder.scrapParts}</span>
      <span>{t("recap.card.stops")}: {m.stopsCount ?? 0}</span>
      <span>{t("recap.card.cycleTime")}: {m.activeWorkOrder.cycleTime != null ? `${m.activeWorkOrder.cycleTime.toFixed(1)}s` : "—"}</span>
    </div>
  </>
)}
Acceptance

Recap card shows: status, OEE, good/scrap/stops/cycleTime, mini timeline, WO/SKU/Mold row, footer without duplicate WO.
Machines tab card shows: status, last-seen, WO/SKU/Mold row, good/scrap/stops/cycleTime — same layout as Recap (just running totals instead of 24h).
Both endpoints (/api/recap and /api/machines) return cycleTime on every machine where data exists.


WI-C — Scrap source of truth (recap aggregation)
Problem

Machines tab scrap value reflects KpiSnapshot.scrap (WO running total). Includes manual scrap.
Recap scrap value sums MachineCycle.scrapDelta over 24h. Manual scrap entries don't write cycle rows, so they're missing.

Result: Recap shows 0 scrap while Machines shows the correct WO total. Confusing for managers.
Fix
Extend recap scrap aggregation to also pull from ReasonEntry (kind=scrap) — that's where manual entries now land thanks to the Pi numpad flow.
File: lib/recap/getRecapData.ts
Find the scrap aggregation logic (currently summing cycle.scrapDelta per machine).
Extend to also query and add:
typescriptconst manualScrapByMachine = await prisma.reasonEntry.groupBy({
  by: ["machineId"],
  where: {
    orgId,
    kind: "scrap",
    capturedAt: { gte: rangeStart, lte: rangeEnd },
  },
  _sum: { scrapDelta: true },  // or whatever the qty column is on ReasonEntry
});

const manualScrapMap = new Map(
  manualScrapByMachine.map((r) => [r.machineId, r._sum.scrapDelta ?? 0])
);

// In the per-machine summary:
const totalScrap = (cycleScrapSum ?? 0) + (manualScrapMap.get(machineId) ?? 0);
⚠️ Check the actual column name on ReasonEntry — earlier inspection suggested scrapDelta is on MachineEvent for scrap-manual-entry, but the reasonIngest path in Build Event Outbox Payload may not currently carry scrapDelta into ReasonEntry at all. Two possible paths:

Preferred: Add scrapDelta to the reasonIngest payload on the Pi side (separate Pi handoff item) and read it from ReasonEntry here. Cleanest, one source.
Alternative (CT-only, no Pi change needed): Query MachineEvent with eventType='scrap-manual-entry' directly and sum data->>'scrapDelta':

typescript   const manualScrap = await prisma.$queryRaw<{ machineId: string; total: number }[]>`
     SELECT "machineId", SUM((data->>'scrapDelta')::int) AS total
     FROM "MachineEvent"
     WHERE "orgId" = ${orgId}
       AND "eventType" = 'scrap-manual-entry'
       AND ts BETWEEN ${rangeStart} AND ${rangeEnd}
     GROUP BY "machineId";
   `;
Use this until path (1) is in place. Faster to ship.
Acceptance

Operator enters scrap via Pi HMI → within one recap refresh cycle, the recap card's scrap number matches what the Machines tab shows (modulo 24h window vs WO total — discuss with BEMIS so they understand legitimate differences).
No double-counting: confirm cycle-scrap and manual-scrap sources are mutually exclusive (cycles don't emit scrap; manual entries don't write cycles).


WI-D — Render-time downtime label resolver (optional, after WI-A clean)
Once WI-A backfill is verified, new entries are clean and old entries are fixed. WI-D is defense in depth: re-resolve labels at render time so even if some future code path emits a partially-formed ReasonEntry, the UI still displays correctly.
Files: wherever ReasonEntry.detailLabel / reasonLabel is rendered — alerts inbox, Reports, recap timeline tooltips, machine detail pages.
Pattern:
typescriptimport { findCatalogReasonByReasonCode } from "@/lib/reasonCatalog";

// at render:
const resolved = findCatalogReasonByReasonCode(catalog, "downtime", row.reasonCode);
const displayLabel = resolved?.reasonLabel ?? row.reasonLabel ?? `${row.categoryLabel} > ${row.detailLabel}`;
Skip if WI-A clean and no recurring drift observed.

Out of scope (Pi side — separate handoff)
Tracked here for visibility only:

Speaker beep on Pi (browser Web Audio in Home Template; trigger conditions: cycles arriving without productionStarted, active macrostop).
Pi-side normalizeCatalogItems cleanup (already addressed: reasonCode, prefix, active now preserved).
Paro micro/macro merge — BEMIS still deciding presentation. Internals must stay separated for OEE math (cycle-gap ≤ 1.5× ideal = performance loss, longer = availability loss).
scrapDelta plumbing in Pi's Build Event Outbox Payload (path 1 of WI-C). Required if you want WI-C to read from ReasonEntry instead of MachineEvent.


Verification ritual (for each WI)
bashcd /home/mdares/mis-control-tower
npx tsc --noEmit
npm run build
sudo systemctl restart mis-control-tower
Then poke the relevant page and confirm acceptance criteria. Don't stack changes — verify each WI before starting the next.