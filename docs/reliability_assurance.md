# Reliability Assurance & Trust / Value-Proof Program

**Purpose:** turn around the client's confidence that MIS can deliver a ≥20 % downtime
reduction and positive ROI. This is the master plan + living status log so work survives
across sessions. Update the status checkboxes as items land.

> Companion docs: `docs/METRICS_SPEC.md` (R1–R8 calculation rules), `docs/ROI_MODEL.md`
> (baseline + 20 % math), `docs/archive/downtime_menu.md` (operator reason-capture UX spec).

---

## 1. Context — why this exists

The client paused the project. Stated drivers: economics, but actionably they want **more
technical solidity, clearer/robust data and reports, the ability to translate data into
concrete actions, and a defensible ROI** before resuming. Two trust-killers surfaced in person:

1. **Operators don't classify downtime** → almost everything is `UNCLASSIFIED` → the downtime
   analysis looks empty/useless.
2. **KPIs don't always match across screens** → the moment one number disagrees, the client
   stops trusting *every* number.

**Reframe from code exploration (the foundation is stronger than perceived):**

- KPI mismatches are **not** calculation bugs. A single source of truth already exists
  (`lib/metrics/`, R1–R8, with a passing consistency test). Mismatches came from the **display
  layer** (live snapshot vs windowed average shown unlabeled) and from **inconsistent shift
  filtering** (reports filtered to planned shifts; the dashboard didn't).
- Unclassified downtime is the real operational hole: the data model, ingest and reporting all
  support classification, but the **operator capture UX was never deployed** (the Pi touchscreen
  reason-modal in `docs/archive/downtime_menu.md` is not in `edge/flows.json`), and there's no
  web "reclassify" button.
- ROI proof is mostly built (`lib/financial/impact.ts`, Pareto, `scripts/capture-baseline.ts`,
  `docs/ROI_MODEL.md`). Gaps: cost rates are placeholders (1 MXN/min) and there's no before/after
  ROI UI.

**Key measurement insight:** `computeDowntime` measures stoppage *minutes* regardless of whether
a reason is attached, so the **historical reduction-in-minutes baseline is reliable even with low
classification**. Classification only sharpens the Pareto "where to act" story, not the headline
ROI number.

**Decisions taken (with the user):**
- Integrated program covering all three gaps, **balanced**.
- Sequenced: **internal prove-it sprint → client-facing deliverable**.
- Proof built from **historical pilot data** in `control_tower_db`.
- **Shift semantics: shift-aware everywhere** — downtime counts only inside configured production
  shifts, on every screen (orgs with no shift schedule are treated as 24/7).

---

## 2. Guiding principles

- **One number, everywhere, labeled.** Reuse the `lib/metrics/` authority; fix only the
  display/call layer. Never show a KPI without its window + "as of" freshness.
- **Make classification frictionless at the moment of the stop**, not a chore done later.
- **Measure ROI against the same number the dashboard shows** — the client can verify it on screen.
- Don't rebuild what exists; close the last-mile gaps.

---

## 3. The plan (workstreams)

### Workstream A — Number consistency
- **A1** Label every KPI with window mode + freshness (live snapshot vs period average).
- **A2** Centralize shift + window math; make downtime shift-aware everywhere.
- **A3** Cross-path consistency health endpoint + cross-endpoint test; surface it in admin UI.
- **A4** In-app methodology/definitions page.

### Workstream B — Classification rate (turn UNCLASSIFIED into action)
- **B1** Deploy the Pi operator reason-capture modal (`docs/archive/downtime_menu.md` → `edge/flows.json`),
  emitting `downtime-acknowledged` with a `reasonCode`. *The single biggest lever.*
- **B2** Seed the reason catalog with the client's real 9-category Spanish taxonomy so it's never empty.
- **B3** Web reclassification: "Classify" action (inline + bulk) on `UNCLASSIFIED` rows in
  `components/downtime/DowntimePageClient.tsx`, posting via the reclassify route.
- **B4** Accountability + nudges: `classifiedBy`/`classifiedAt` on `ReasonEntry`; "needs
  classification" worklist + daily reminder (reuse `lib/alerts/engine.ts`,
  `app/api/downtime/actions/reminders/route.ts`).
- **B5** Surface classification rate as a headline KPI (≥80 % target) on dashboard + weekly report
  (`lib/reports/queries/classificationRate.ts` already computes it).

### Workstream C — ROI proof (the success case)
- **C1** Enter the client's real cost rates (`OrgFinancialProfile` via `app/api/financial/costs/route.ts`);
  warn "illustrative only" while placeholders remain.
- **C2** ROI tracker page (`/reports/roi`): baseline vs current unplanned downtime, % vs target (20 %),
  savings = reduction_min × real cost/min — all from `computeDowntime`/`episodeWindowMinutes` so it
  equals the dashboard. Store target on org settings.
- **C3** 90-day rolling unplanned-downtime trend (extend `lib/reports/queries/oeeTrend.ts` pattern).
- **C4** Retrospective success case from historical data: `npm run baseline:capture` against
  `control_tower_db`; narrative of total/unplanned trend + top losses + 20 % math at real rate.
  Optionally bulk-reclassify a sample of historical `UNCLASSIFIED` episodes (uses B3) for the Pareto
  view — labeled as a retrospective reconstruction.
- **C5** Automated weekly/monthly ROI email (extend `lib/email.ts` + reminder cron).

### Phase 2 — Client-facing deliverable
A short doc/deck packaging the sprint: (1) consistency fix + methodology page; (2) classification
fix + before/after classification-rate chart; (3) ROI success case (baseline → current → % → pesos
at *their* rates, screenshotted from the ROI tracker); (4) re-engagement proposal.

---

## 4. STATUS — what's done vs pending

Legend: ✅ done · 🔲 pending

### Workstream A — Number consistency — ✅ COMPLETE

**✅ A2 — One shift authority, shift-aware everywhere**
- New `lib/metrics/shift.ts`: canonical `resolveShiftName` / `isInPlannedShift` / `hasPlannedShifts`,
  with a **24/7 guard** (no usable shift schedule ⇒ always in-shift). Exported via `lib/metrics`.
- `lib/reports/queries/shiftPlanning.ts` now re-exports those (kept `loadShiftPlanningContext`).
  Side-effect fix: previously, orgs with **no shifts configured** had reports show **zero downtime**
  while the dashboard showed everything — the 24/7 guard fixes that.
- `lib/recap/getRecapData.ts`: removed ~80 lines of duplicated tz/shift helpers; uses the shared
  resolver; **downtime is now filtered by `isInPlannedShift`** even when no specific shift is selected.
- `lib/financial/impact.ts`: downtime cost pass is now shift-aware too (was the would-be odd-one-out).
- `docs/ROI_MODEL.md`: added a caveat that the baseline must be re-run under shift-aware downtime
  (off-shift idle no longer counts → baseline is lower than the documented 7,904 min).
- Tests: new `tests/metrics/shift.test.ts` (boundaries, overnight, 24/7 guard, disabled shifts).

**✅ A3 — Cross-path consistency health check**
- New `app/api/health/metric-consistency/route.ts` (admin-only). Re-runs a 30-day window through the
  distinct paths feeding distinct screens — **authority** (`computeDowntime`, shift-aware), **recap**
  (dashboard/detail, summed over machines), **reports** (`getLossesByReason`) — and asserts they agree
  within rounding (`recap_vs_authority`, `reports_vs_authority`).
- Surfaced in the admin health card on `app/(app)/settings/page.tsx` (`loadHealth` now fetches both
  `/api/health/consistency` (DB integrity) and `/api/health/metric-consistency` (cross-screen
  congruence) and merges them).
- Tests: `tests/metrics/consistency.test.ts` gained two cross-path invariants (downtime additive across
  machines; Σ `episodeWindowMinutes` == authority total).

**✅ A1 — KPI tiles labeled by mode + freshness**
- New `components/kpi/KpiTile.tsx`: shared tile with a mode/freshness caption + explicit empty state.
- `app/(app)/overview/OverviewClient.tsx`: four KPI tiles caption "Live · avg across machines";
  stale (10-min gate) shows "no live data (>10 min)" instead of a bare "—".
- `app/(app)/machines/[machineId]/MachineDetailClient.tsx`: all four "current" tiles now carry a
  consistent "updated X ago" / "no data" caption (previously only OEE did).
- i18n keys added (en + es-MX): `overview.kpiLiveCaption`, `overview.kpiLiveEmpty`.
- Recap (`components/recap/RecapKpiRow.tsx`) already labels its window ("OEE Avg 24h / Yesterday /
  Custom"); now reads as clearly distinct from "Live" — left as-is.

**✅ A4 — In-app methodology page**
- New `app/(app)/methodology/page.tsx` (`/methodology`, bilingual): one source of truth, OEE=A×P×Q,
  Live vs period-average, planned vs unplanned, shift-aware downtime, unclassified, ROI/20 % method,
  built-in consistency check. Wording mirrors `METRICS_SPEC.md` / `ROI_MODEL.md`.
- Sidebar nav entry added (`components/layout/Sidebar.tsx`, `BookOpen` icon); i18n key `nav.methodology`.

**Verification (as of last session):** `npx tsc --noEmit` clean · `npx vitest run` → 75 tests pass ·
eslint clean on changed files · both i18n JSON files parse.

### Workstream B — Classification rate — 🟡 MOSTLY DONE (code complete; B1 deploy + B4 nudges pending)

**🟢 B1 — Pi reason-capture modal — already implemented in `edge/flows.json` (deploy/verify pending)**
- The committed edge flow already contains the operator capture pipeline: `Anomaly Alert System
  (Global)` (ui_template modal), catalog hydration (`Apply settings + update UI`, `reasonCatalogData`,
  2-level breadcrumb), `Handle Anomaly Acknowledgment` (emits `downtime-acknowledged`), and
  `Build Reason HTTP` → `POST /api/ingest/reason`. The cloud ingest accepts the enriched reason.
- **Not rewritten** (a 500 KB deployed Node-RED artifact — editing blind would be reckless).
- **Remaining (operational, needs Pi + sim):** deploy the current flow, run the B2 seed, trigger
  stops in ESP32 sim mode, confirm the modal captures a reason and it lands as a classified episode.

**✅ B2 — Seed reason catalog (9-category Spanish taxonomy)**
- New `scripts/seed-reason-catalog.ts` (npm: `seed:reason-catalog:taxonomy`). Idempotent; seeds both
  downtime (9 categories) and scrap (5 categories) from `docs/archive/downtime_menu.md`.
- **"Molde / Cambio de molde" → reasonCode `MOLD_CHANGE`** so `computeDowntime` treats it as PLANNED.
- Run: `npm run seed:reason-catalog:taxonomy <orgId>`. (An xlsx-based `seed:reason-catalog` already
  existed; this is the no-Excel taxonomy path.)

**✅ B3 — Web reclassification**
- New `app/api/downtime/reclassify/route.ts` (session-auth): `GET` returns active downtime reason
  options for the picker; `POST { reasonEntryId, reasonCode, categoryId?, reasonText? }` updates the
  episode's classification and stamps `classifiedBy/At/Via="web"`. Reuses the catalog label-resolution
  rules from `/api/ingest/reason`; touches classification only (never timing).
- New `components/downtime/ReclassifyModal.tsx`: category → reason picker + "Other (free text)".
- `components/downtime/DowntimePageClient.tsx`: per-row **Classify**/**Reclassify** button in the events
  table (amber when unclassified) opens the modal; success refreshes the table via a reload nonce.

**🟡 B4 — Accountability fields done; nudges pending**
- ✅ Added `classifiedBy` / `classifiedAt` / `classifiedVia` to `ReasonEntry` (`prisma/schema.prisma`)
  + migration `prisma/migrations/20260620180000_add_reason_classified_by/`. Prisma client regenerated.
  **⚠️ Migration not yet applied to any DB** — run `npm run prisma:migrate:deploy` (or `prisma migrate
  deploy`) against the target DB before the web reclassify route writes those columns in prod.
- 🔲 "Needs classification" worklist + daily reminder (reuse `lib/alerts/engine.ts`,
  `app/api/downtime/actions/reminders/route.ts`) — not yet built.

**✅ B5 — Classification-rate headline KPI**
- `DowntimePageClient.tsx` KPI strip now shows **Classification rate** vs a **≥80 % target** (green when
  met, red below), computed from `totalEventsClassified / totalEventsAll` (replaces the bare
  "Unclassified %" tile, which is now shown as a sub-line).

**Verification (this session):** `npx tsc --noEmit` clean · `npx vitest run` → 75 tests pass · new
files lint-clean (pre-existing lint debt in `DowntimePageClient.tsx` untouched).

### Workstream C — ROI proof — 🟡 MOSTLY DONE (code complete; C4 operational + config UI pending)

**✅ C2 — ROI tracker page + API**
- New `lib/reports/roi.ts` (`computeRoi`): baseline vs current unplanned downtime via the SAME
  authority (`computeDowntime`, shift-aware), normalized to **min/day** so unequal windows compare
  fairly; reduction % vs target; monthly savings = min/day removed × cost/min × 30.
- New `app/api/reports/roi/route.ts` (session-auth) and page `app/(app)/reports/roi/page.tsx`
  (headline reduction vs target, baseline/current cards, savings, 13-week trend bars). Linked from
  the reports hub ("ROI tracker" button in `ReportsPageClient.tsx`).
- Baseline window + target read from `OrgSettings.defaultsJson.roi` (`baselineStart`, `baselineEnd`,
  `targetReductionPct`); defaults: target 20 %, baseline = the 30 days before the current window.

**✅ C1 — Cost-rate honesty**
- `lib/reports/roi.ts` flags `costRatesArePlaceholder` (no profile, or machine rate still the 1/min
  stub per `ROI_MODEL.md`). The tracker shows an amber "illustrative only" banner and the email omits
  the money figure entirely until real rates are set (Settings → Financial).

**✅ C3 — 90-day trend**
- `computeRoi` returns a 13-week weekly trend of unplanned min/day; rendered as bars on the tracker.

**🔲 C4 — Retrospective success case — OPERATIONAL (not code)**
- Run `npm run baseline:capture` against `control_tower_db` to snapshot the real before/after, then
  read the ROI tracker / `ROI_MODEL.md` to assemble the narrative. The web reclassify (B3) lets us
  populate the historical Pareto. Nothing to build — needs a run against the data.

**✅ C5 — Automated ROI email (builder + endpoint; needs SMTP + cron to deliver)**
- `buildRoiSummaryEmail` in `lib/email.ts` (pure, unit-tested in `tests/reports/roiEmail.test.ts`).
- New `app/api/reports/roi/email/route.ts`: cron-only, secret-gated (`ROI_SUMMARY_EMAIL_SECRET`),
  fans out per org to active `AlertContact` emails. **Needs SMTP env + a scheduled POST to actually
  send** — not verifiable in this environment.

**Verification (this session):** `npx tsc --noEmit` clean · `npx vitest run` → 78 tests pass (incl.
new `roiEmail.test.ts`) · new files lint-clean.

### Phase 2 — Client deliverable — 🔲 PENDING (after the loose ends below close)

---

## 4b. LOOSE ENDS (the gap between "code done" and "live for the client")

These are the operational / config / deploy steps that code alone can't finish. Close these to make
the program real end-to-end:

1. **Apply the DB migration** `20260620180000_add_reason_classified_by`
   (`npm run prisma:migrate:deploy` against the target DB). Until then the web reclassify route
   cannot write `classifiedBy/At/Via` in prod. *(B4)*
2. **Seed the reason catalog** for each org: `npm run seed:reason-catalog:taxonomy <orgId>`. An empty
   catalog means operators literally cannot classify. *(B2)*
3. **Deploy the edge flow + verify capture in ESP32 sim mode** — confirm the Pi modal writes a real
   reason that lands as a classified episode and shows in the downtime page + classification-rate KPI. *(B1)*
4. **Set real cost rates** in Settings → Financial (replace the 1/min placeholders) so the ROI money
   figure stops being illustrative. *(C1)*
5. ✅ **ROI baseline + target now UI-editable** on `/reports/roi` ("Configure baseline & target",
   admin-only) → stored on dedicated `OrgSettings` columns (`roi_baseline_start/end`,
   `roi_target_reduction_pct`; migration `20260620190000_add_roi_config` — **apply it**:
   `npm run prisma:migrate:deploy`). Legacy `defaultsJson.roi` is still read as a fallback. *(C2)*
6b. ✅ **Per-org planned-reason-codes — FIXED (Option A).** Added a `planned` flag to
   `ReasonCatalogCategory` (migration `20260620200000_add_category_planned`) + a "Planned downtime"
   toggle in the catalog UI (`ReasonCatalogConfig`, downtime categories only) + category PATCH/GET
   support. New resolver `lib/downtime/plannedCodes.ts:getPlannedReasonCodes(orgId)` (planned-category
   codes ∪ legacy `MOLD_CHANGE`), threaded through **every** `computeDowntime` caller — recap, ROI,
   financial impact, and the metric-consistency health check — so the planned/unplanned split is
   consistent everywhere. Unit-tested in `tests/metrics/downtime.test.ts`.
   **REMAINING (operational): mark BEMIS's DTPLN category planned** so the fix takes effect for BEMIS —
   either tick Settings → Reason catalog → "Planeado/DTPLN" → *Planned downtime*, or:
   `UPDATE reason_catalog_category SET planned=true WHERE org_id='6d2abda2-…' AND code_prefix='DTPLN';`
   (after applying the migration). Then re-run `npm run baseline:capture` (loose end #9).
6. **Run `npm run baseline:capture`** against `control_tower_db` and assemble the retrospective
   before/after narrative. *(C4)*
7. **Configure SMTP + schedule the ROI email** (`ROI_SUMMARY_EMAIL_SECRET` + a cron POST to
   `/api/reports/roi/email`). *(C5)*
8. **B4 nudges (optional):** "needs classification" worklist + daily reminder.
9. **Re-confirm the ROI baseline** after shift-aware downtime + any edge-capture (Phase 6) changes —
   the documented 7,904 min/month predates shift filtering (see `ROI_MODEL.md`). *(A2/C)*

---

## 5. Critical files (map)

- **Metrics authority (reuse):** `lib/metrics/{rates,downtime,window,shift,machineState}.ts`,
  `docs/METRICS_SPEC.md`, `tests/metrics/`.
- **A — display/consistency (done):** `lib/machines/withLatest.ts`, `lib/overview/getOverviewData.ts`,
  `lib/recap/getRecapData.ts`, `app/api/machines/[machineId]/route.ts`,
  `app/api/health/metric-consistency/route.ts`, `components/kpi/KpiTile.tsx`,
  `app/(app)/methodology/page.tsx`, `components/layout/Sidebar.tsx`, `lib/i18n/{en,es-MX}.json`.
- **B — classification (done in code):** `app/api/downtime/reclassify/route.ts` (new),
  `components/downtime/ReclassifyModal.tsx` (new), `components/downtime/DowntimePageClient.tsx`
  (Classify buttons + classification-rate KPI), `scripts/seed-reason-catalog.ts` (new),
  `prisma/schema.prisma` (`ReasonEntry` + migration `20260620180000_add_reason_classified_by`),
  `edge/flows.json` (modal already built), `app/api/ingest/reason/route.ts`,
  `lib/reports/queries/classificationRate.ts`. **B4 nudges still TODO:** `lib/alerts/engine.ts`,
  `app/api/downtime/actions/reminders/route.ts`.
- **C — ROI (done in code):** `lib/reports/roi.ts` (new), `app/api/reports/roi/route.ts` (new),
  `app/(app)/reports/roi/page.tsx` (new), `app/(app)/reports/ReportsPageClient.tsx` (ROI link),
  `lib/email.ts` (`buildRoiSummaryEmail`), `app/api/reports/roi/email/route.ts` (new),
  `tests/reports/roiEmail.test.ts` (new). Operational/reference: `app/api/financial/costs/route.ts`,
  `scripts/capture-baseline.ts`, `docs/ROI_MODEL.md`.

---

## 6. Verification recipes

- **Consistency:** `npx vitest run tests/metrics` · hit `/api/health/metric-consistency` (admin) for a
  fixed window/machine, confirm `ok: true`/zero drift · manually load overview, machine detail, recap,
  weekly report for the same machine/window and confirm the same metric matches (or is clearly labeled
  as a different window/mode).
- **Classification (after B):** in ESP32 sim mode, trigger stops → confirm the Pi modal captures a
  reason and the episode shows classified in the downtime page and in `getClassificationRate`; confirm
  the web reclassify button moves a historical `UNCLASSIFIED` episode to a real reason.
- **ROI (after C):** set real cost rates, run `npm run baseline:capture` against `control_tower_db`,
  open the ROI tracker, confirm its unplanned-downtime equals the dashboard/financial figure for the
  same window; reproduce the `ROI_MODEL.md` baseline via `scripts/metrics/financial-rebase-check.ts`.

---

## 7. Resume here next

**All three workstreams (A, B, C) are code-complete.** What remains is in **§4b Loose Ends** —
deploy/config/operational steps (apply migration, seed catalog, deploy edge flow + sim verify, set
real cost rates + ROI baseline, run `baseline:capture`, configure SMTP/cron for the ROI email).

Once those close, do **Phase 2 — the client-facing deliverable**: package the consistency fix +
methodology page, the classification fix + before/after classification-rate chart, and the ROI success
case (baseline → current → % → pesos at real rates, screenshotted from `/reports/roi`) into a short
deck, plus the re-engagement proposal.
