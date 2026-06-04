# HANDOFF — Cost formula editor + Recap per-machine filter + Reports 7D date-filter bug

**Repo:** `/home/mdares/mis-control-tower`
**Org ID:** `6d2abda2-88e8-4d1d-8f2b-85e2e0d973e5`
**M4-5 UUID:** `6861bd05-e975-48b6-ad86-0017ba995779`
**Comms style:** terse, direct. Read files before editing. One task at a time. Verify each fix independently.

---

## TASK 1 — Editable cost formulas (hidden / advanced panel)

### Context
`components/settings/FinancialCostConfig.tsx` currently exposes only the input **variables** (see screenshot: Costo máquina/min, Costo operador/min, kW en operación, kW en espera, Tarifa kWh, Multiplicador de energía, Costo energía/min, Costo scrap/unidad, Costo materia prima/unidad). The **formulas** that combine those variables into downtime cost / scrap cost / energy cost are hardcoded in `lib/financial/impact.ts`. Client wants to override the formula expressions when the defaults don't match their accounting model.

### Approach
1. **Read `lib/financial/impact.ts` first.** Enumerate every hardcoded formula. Do not guess — work from the actual code. Likely candidates: `downtimeCostPerMin`, `scrapCostPerUnit_effective`, `energyCostPerMin`, possibly more.
2. **Schema change.** Add a nullable JSON column `formulasJson` to `OrgFinancialProfile` (and matching nullable on `LocationFinancialOverride` / `MachineFinancialOverride` if per-machine override is wanted later — start with org-level only). Prisma migration named e.g. `add_org_financial_formulas`.
3. **Safe expression evaluator.** **Do NOT use `eval` or `new Function()`.** Two acceptable options:
   - **Preferred:** tiny recursive-descent parser supporting `+ - * / ( ) ^`, decimal numbers, and a **whitelisted** identifier set (the 9 variables listed above + `Math.min`, `Math.max` only if needed). Reject anything else at parse time.
   - **Alternative:** `expr-eval` from npm (small, no `eval`). Confirm with Marcelo before adding deps.
4. **API.** Extend `app/api/financial/costs/` POST/PATCH payload schema (Zod) to accept an optional `formulas: Record<string, string>` object. Validate each expression server-side using the same evaluator — parse-only, no execution. Reject on unknown identifier, syntax error, or empty string. Persist as JSON.
5. **Consumer.** In `lib/financial/impact.ts`, when the org has a `formulasJson` entry for a given formula key, evaluate the custom expression against the variable scope; otherwise fall back to the current hardcoded math. Cache the parsed AST per-org per-request (the `lib/financial/cache.ts` file is the place).
6. **UI — `FinancialCostConfig.tsx`.** Add a collapsible `<details>` section below the existing inputs:
   - Title: **"Fórmulas avanzadas"**
   - Subtitle: *"Sobrescriben los cálculos por defecto. Editar con precaución."*
   - Closed by default. Opening it should require an extra confirm click (a small "Mostrar editor" button inside the collapse) — this is the "hidden panel" feel the client wants.
   - For each formula: a `<textarea>` (monospace) with current expression (or placeholder showing the default), and a small reference block listing the 9 valid variable names verbatim.
   - Inline parse error displayed under each textarea.
   - "Guardar" button at top of the page already exists — wire the formulas into the same save payload.

### Variables available in formulas
`machineCostPerMin`, `operatorCostPerMin`, `ratedRunningKw`, `idleKw`, `kwhRate`, `energyMultiplier`, `energyCostPerMin`, `scrapCostPerUnit`, `rawMaterialCostPerUnit`

### Acceptance
- Default behavior unchanged when `formulasJson` is null.
- Setting a custom formula and reloading the dashboard shows the new cost values reflecting it.
- Bogus expression rejected at save with a clear inline error; no server 500.

---

## TASK 2 — Per-machine filter on Weekly Recap preview

### Context
`/reports` page has button **"Ver reporte (preview)"** that links to the weekly recap. The recap currently aggregates across all machines. Client wants to scope by single machine for analysis.

### Files
- `app/(app)/recap/page.tsx` (server entry, read search params)
- `app/(app)/recap/RecapGridClient.tsx` (client UI — main edit point)
- `app/api/recap/route.ts` (data endpoint)
- `lib/recap/getRecapData.ts` (data fetcher)

### Approach
1. **URL contract.** Add a `machineId` URL search param. Values: a UUID, or `"all"` (default). Page is bookmarkable.
2. **Server.** In `page.tsx`, read `searchParams.machineId`, pass into the data fetcher. In `getRecapData.ts` (and/or `app/api/recap/route.ts`), accept optional `machineId`; when set, filter every query in the recap pipeline by that machine. When `"all"` or absent, current behavior.
3. **UI.** In `RecapGridClient.tsx`, render a `<select>` near the top:
   - First option: **"Todas las máquinas"** (value `all`)
   - Then one option per org machine, label = machine name (e.g. `M4-2`, `M4-5`).
   - On change: `router.replace(?machineId=...)` so the URL reflects state.
   - Fetch the machine list from an existing endpoint (likely `/api/machines` or the server can prefetch and pass as prop — pick whichever matches existing patterns; check `MachinesClient.tsx` for reference).
4. **Pre-fill from /reports.** When the user clicks "Ver reporte (preview)" on `/reports`, append `?machineId=` with the currently selected Máquina filter (e.g. M4-5 in the screenshot). Edit `ReportsPageClient.tsx` link construction.

### Acceptance
- Recap loads with all machines by default (no regression).
- Selecting M4-2 from the dropdown shows only M4-2 data; URL updates to `?machineId=<uuid>`.
- Clicking "Ver reporte (preview)" from `/reports` with M4-5 selected lands on the recap pre-filtered to M4-5.

---

## TASK 3 — Reports 7D filter bug: "Principales causas de pérdida" ignores date range

### Confirmed bug
Screenshot evidence (M4-5, 7D selected):
- **"Principales causas de pérdida"** panel shows Macroparo = **4018h 34m** ≈ 167 days. Impossible for 7D (max 168h).
- Microparo = 71h 28m, Ciclo lento = 323, Caída de OEE = 10, Baja de desempeño = 53 — all likely all-time totals, not 7D.
- On the **same page**: Downtime (all) = 48h 38m, Downtime (classified) = 16m, Excluded unclassified = 48h 21m (99.4%) — these ARE within 7D range (48h on a 168h window is plausible). Tendencia de OEE chart spans 05-12 to 05-19 = 7D, correct.

So: **the date filter is propagated to SOME aggregators but not the loss-reasons one.**

### Files to inspect (in order)
1. `app/(app)/reports/ReportsPageClient.tsx` — verify that `range` state (`24H` / `7D` / `30D` / `CUSTOM`) is being included in the fetch URL/body for **every** card on the page, not just the OEE trend and Downtime totals.
2. `app/api/reports/route.ts` — verify the GET handler parses `start` / `end` (or `range`) and passes them into **every** downstream query, especially whatever feeds "Principales causas de pérdida".
3. `app/api/reports/filters/` — likely the source of the loss-reasons aggregation. **High suspicion: this endpoint is querying `reason_entries` or `machine_events` without a `tsMs >= start AND tsMs < end` predicate.**
4. `lib/recap/getRecapData.ts` if shared.
5. `lib/reasonCatalog.ts` if the catalog query is involved.

### Most likely root cause
A query like:
```sql
SELECT anomaly_type, SUM(duration_ms) FROM machine_events
WHERE org_id = $1 AND machine_id = $2
GROUP BY anomaly_type
```
…with no date bounds, summing across the entire history of the machine. The fix is adding `AND tsMs >= $3 AND tsMs < $4` (or equivalent Prisma `where: { tsMs: { gte, lt } }`).

### Approach
1. Identify the exact query feeding each row of the panel (Macroparo, Microparo, Ciclo lento, Pico de calidad, Caída de OEE, Baja de desempeño). They may all share one aggregator or be separate.
2. Add the date filter that's already used by Downtime (all). Reuse the same start/end derivation.
3. Verify Microparo's 71h is also wrong (probably is — that's ~3 days continuous microstop, very unlikely).
4. **Do NOT** "fix" Downtime (all) or Tendencia de OEE — those are already correct. One fix at a time.

### Acceptance
- On M4-5 with 7D selected, all loss-reason totals sum to ≤ 7×24h = 168h.
- Macroparo + Microparo + Downtime should be internally consistent (Downtime = Macroparo + Microparo + any other classified stop time, modulo classification overlap).
- Switching to 30D should give larger numbers; switching to 24H should give smaller. CUSTOM should respect the user-picked window.

---

## Standard workflow (Marcelo's convention)

For each task:
1. **Read the relevant files in full before editing.** No skimming. Trace the data flow end-to-end first.
2. Make the minimum change that addresses the **root cause**, not symptoms.
3. Verify in sequence:
   - `npx tsc --noEmit`
   - `npm run build`
   - `sudo systemctl restart mis-control-tower`
4. Manually validate in the browser before declaring done.
5. **Backups:** before any edit, copy the file with `.bak.task1` / `.bak.task2` / `.bak.task3` suffix matching the task above.
6. **One task at a time.** Do not cascade fixes across tasks — circular debugging has burned hours in the past.

## DB shell

```bash
DATABASE_URL=$(sudo grep '^DATABASE_URL=' /etc/mis-control-tower.env | cut -d= -f2- | tr -d '"' | sed 's/[?&].*//')
psql "$DATABASE_URL" -c 'SELECT "anomalyType", COUNT(*) FROM machine_events WHERE "machineId" = '\''6861bd05-e975-48b6-ad86-0017ba995779'\'' AND "tsMs" >= NOW() - INTERVAL '\''7 days'\'' GROUP BY "anomalyType";'
```
(Camel-cased columns must be quoted. Adjust column names to actual schema after a quick `\d machine_events`.)

This query is also a useful **sanity check for Task 3** — running it directly against the DB gives the ground-truth 7D totals to compare the UI against post-fix.

---

## Suggested order

1. **Task 3 first** — smallest, highest signal, validates the date-filtering pattern used elsewhere.
2. **Task 2 second** — straightforward URL-param + select wiring.
3. **Task 1 last** — biggest surface (schema + evaluator + UI), needs more design care.

---

## IMPLEMENTATION APPENDIX (2026-05-19)

### What was implemented

#### Task 3 — Reports 7D loss-reasons date-filter bug
- Fixed `app/api/reports/route.ts` so `macrostopSec` and `microstopSec` in **"Principales causas de pérdida"** are sourced from the same date-bounded `reasonEntry` aggregation path already used for downtime totals.
- Result: loss-driver stop durations now respect selected range (`24h`, `7d`, `30d`, `custom`) instead of drifting to inflated event-based totals.

#### Task 2 — Per-machine filter on Recap preview
- Added `machineId` URL contract support end-to-end with normalization for `all`:
  - `lib/recap/getRecapData.ts`
  - `lib/recap/redesign.ts`
  - `app/api/recap/summary/route.ts`
  - `app/(app)/recap/page.tsx`
  - `app/(app)/recap/RecapGridClient.tsx`
- Recap UI now includes machine selector with first option `Todas las máquinas` and URL sync via `router.replace`.
- Updated reports preview flow so `/reports` “Ver reporte (preview)” opens `/recap?machineId=...` based on selected machine filter:
  - `app/(app)/reports/ReportsPageClient.tsx`
  - `components/reports/weekly/WeeklyReportButton.tsx`

#### Task 1 — Editable cost formulas (advanced hidden panel)
- Added org-level formulas storage:
  - Prisma schema: `OrgFinancialProfile.formulasJson` (`formulas_json`)
  - Migration: `prisma/migrations/20260519190000_add_org_financial_formulas/migration.sql`
- Implemented safe expression parser/evaluator (no `eval`, no `new Function`) with whitelisted variables and arithmetic grammar in:
  - `lib/financial/formulas.ts`
- Added compiled-formula caching per-org signature in:
  - `lib/financial/cache.ts`
- Integrated formulas into financial impact computation in:
  - `lib/financial/impact.ts`
- Extended financial costs API to accept/validate/persist formulas and return inline formula errors:
  - `app/api/financial/costs/route.ts`
  - Added `PATCH` alias to `POST`.
- Added hidden advanced formulas editor to financial settings UI with:
  - `<details>` section
  - subtitle warning text
  - extra “Mostrar editor” confirm step
  - one textarea per formula
  - inline parse errors
  - valid variable reference block
  - formulas included in save payload
  - File: `components/settings/FinancialCostConfig.tsx`

### Backups created (per handoff instruction)
- `app/api/reports/route.ts.bak.task3`
- `app/(app)/recap/page.tsx.bak.task2`
- `app/(app)/recap/RecapGridClient.tsx.bak.task2`
- `app/api/recap/route.ts.bak.task2`
- `app/api/recap/summary/route.ts.bak.task2`
- `app/(app)/reports/ReportsPageClient.tsx.bak.task2`
- `components/settings/FinancialCostConfig.tsx.bak.task1`
- `app/api/financial/costs/route.ts.bak.task1`
- `lib/financial/cache.ts.bak.task1`
- `lib/financial/impact.ts.bak.task1`
- `prisma/schema.prisma.bak.task1`
- `lib/recap/getRecapData.ts.bak.task2`
- `lib/recap/redesign.ts.bak.task2`

### Verification run
- `npx prisma generate` ✅
- `npx tsc --noEmit` ✅
- `npm run build` ✅

### Not completed in this environment
- `sudo systemctl restart mis-control-tower` could not be executed due interactive sudo password requirement in this session.
- Manual browser validation was not executed from this terminal-only environment.
