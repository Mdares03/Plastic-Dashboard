# Mold Change Visibility — Change Log

**Date:** 2026-06-04
**Author:** Marcelo (via Claude Code)
**Branch:** `sandbox-main`

## Why
KPIs and "top downtime reason" differed between the **Machines** page and the **Daily Recap**.
Root cause of the reason mismatch: the Recap (and the Pareto summary card) **hard-excluded
`MOLD_CHANGE`**, while the Machines page counted it.

Decision: mold change is real downtime that *happened*. It should be **visible and goal-trackable**
in the downtime/Pareto views (tagged as *planned* changeover, it will usually lead the list — that
is the truth), but it must **NOT affect Availability / OEE** (planned downtime is excluded from
availability loss by OEE convention).

## What changed for the user
- Recap "Top stops" now **includes mold change**, shown with a sky-blue **"Planned"** badge.
- The Downtime **Pareto summary card** (machine detail + reports) now includes mold change too,
  drawn as a **sky-blue bar with a "(P)" suffix** and a "Planned" badge in the top-3 list — matching
  the full `/downtime` report (which already showed it).
- Recap **total downtime minutes will be higher** than before (it now counts changeover). A
  `plannedMin` / `unplannedMin` split is now available so the total stays transparent.
- **Machines vs Recap now agree** on downtime (Machines already counted mold change).

## What is NOT affected (by design)
- **OEE / Availability / Performance / Quality are unchanged.** They are computed upstream and
  stored in `machineKpiSnapshot`; Recap only reads them as a time-weighted average. None of the
  edits below touch that path, so planned downtime never enters availability loss.
- Ingest / KPI pipeline — untouched.

---

## Files changed (exact edits)

### 1. `lib/recap/getRecapData.ts` — core logic
**a) Top-reasons loop** (was excluding mold change). The line
`if (code === "MOLD_CHANGE") continue;` was **removed**. Mold change is now aggregated like any
other reason, tagged `planned`, and a `plannedStopDurSec` accumulator was added. Each `topReasons`
row now carries `planned: row.planned`.

**b) Totals.** After `totalMin`, two lines were added:
```ts
const plannedMin = round2(plannedStopDurSec / 60);
const unplannedMin = round2(Math.max(0, totalMin - plannedMin));
```

**c) Returned `downtime` object** now includes `plannedMin` and `unplannedMin`:
```ts
downtime: {
  totalMin,
  plannedMin,      // added
  unplannedMin,    // added
  stopsCount,
  topReasons,
  ongoingStopMin,
},
```

### 2. `lib/recap/types.ts` — types
- `downtime` object type: added `plannedMin: number;` and `unplannedMin: number;`, and added
  `planned: boolean;` to each `topReasons[]` entry.
- `RecapDowntimeTopRow`: added `planned: boolean;`.

### 3. `lib/recap/redesign.ts` — detail mapping
In the `downtimeTop` map (~line 762), added `planned: row.planned,` to each mapped row.

### 4. `components/recap/RecapDowntimeTop.tsx` — recap UI
Reason label is now wrapped in a flex row; when `row.planned` is true it renders a sky-blue
**"Planned"** badge using the new i18n key `recap.downtime.planned`.

### 5. `components/analytics/DowntimeParetoCard.tsx` — Pareto summary card
- Fetch now sends `qs.set("planned", "all");` so the summary matches the full `/downtime` report.
- Added constants `PLANNED_REASON_CODE = "MOLD_CHANGE"`, `UNPLANNED_BAR_COLOR = "#FF7A00"`,
  `PLANNED_BAR_COLOR = "#38BDF8"`, and imported `Cell` from recharts.
- `chartData` rows now compute `planned` and append `" (P)"` to the planned bar's label.
- The `<Bar>` now renders `<Cell>` children so the mold-change bar is sky-blue, others orange.
- The top-3 list shows a "Planned" badge for the `MOLD_CHANGE` row.

### 6. `lib/i18n/en.json` and `lib/i18n/es-MX.json` — strings
Added one key after `recap.downtime.top`:
- EN: `"recap.downtime.planned": "Planned",`
- ES: `"recap.downtime.planned": "Planeado",`

---

## How to revert

> ⚠️ These 7 files had **substantial unrelated uncommitted WIP** before this work (the recap block
> was mid-refactor — in the last commit, mold change was excluded at the DB query level via
> `reasonCode: { not: "MOLD_CHANGE" }`, and the WIP had moved it into the loop). Because of that,
> this change could **not** be isolated into a clean commit on top of `main` without dragging the
> unrelated WIP along. A blanket `git checkout` would also discard that WIP. **Use the patch below.**

**One-command revert** — `mold-change.patch` (committed alongside this doc) captures *exactly* the
mold-change edits and nothing else (verified: `git apply -R --check` passes against the working
tree). To undo just the mold-change work:
```bash
git apply -R mold-change.patch     # removes only the mold-change edits, leaves all other WIP intact
```
To re-apply it later:
```bash
git apply mold-change.patch
```
The patch touches only these 7 files and only the lines listed in "Files changed" above.

**Manual fallback** (if the patch ever stops applying because the surrounding WIP moved): the single
most important line to restore is the exclusion inside the top-reasons loop in
`lib/recap/getRecapData.ts`:
```ts
if (code === "MOLD_CHANGE") continue;
```
…then drop the `planned` / `plannedMin` / `unplannedMin` additions, set the Pareto card fetch back to
omit `planned`, and remove the `recap.downtime.planned` i18n keys + the two badges.

## Verification performed
- `npx tsc --noEmit` — clean.
- Both i18n JSON files parse valid.
- `npm run test:downtime-reason-guard` — passes (3 scenarios, ok).

## Not done (Phase 2 — separate feature)
Assigning a **reduction goal** for changeover (target minutes + actual-vs-goal display). Needs a
target field (e.g. on `ReasonCatalogItem` or a dedicated goal record) + settings UI. Visibility
(this change) is the prerequisite; do goals next.
