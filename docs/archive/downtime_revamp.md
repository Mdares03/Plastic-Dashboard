# Downtime revamp — plan

**Status:** planning only. Execute in a fresh chat (this thread is context-heavy).
**Branch:** continue on `reliability-overhaul` (or a new `downtime-revamp` branch off it).
**Author context:** written right after the full EN/ES i18n + contrast pass, so the i18n
infrastructure and the current Downtime page internals are already known.

---

## 1. Why — the problems we're solving

From the user, about the current `/downtime` page (`components/downtime/DowntimePageClient.tsx`,
~2,600 lines):

1. **Too cluttered.** Header + 8 KPIs + Pareto + reason breakdown + drilldown table + heatmap +
   actions panel + event list, all on one infinite scroll.
2. **Unclear metrics.** MTBF, MTTR, "Availability loss" are rough window-based *proxies*, not
   precise — they confuse rather than inform.
3. **"Exclude unclassified" is buried.** It's a small button at the far right of a crowded filter
   row; the single most useful data-quality control is the hardest to find.
4. **Tasks are an afterthought.** The "Actions & ownership" panel (a real task tracker, who-does-what)
   is wedged next to the heatmap. The user wants it promoted to its **own sidebar tab** so downtime
   tasks can be tracked properly.

## 2. Decisions taken (locked with the user)

| Decision | Choice |
|---|---|
| Task tracker layout | **Kanban board by status** (Open / In progress / Blocked / Done) |
| Simplified KPI set | **Essentials + cost**: Total downtime · Stops · Top reason · Classified % · Est. cost (MXN) |
| Sidebar placement | New **top-level "Action Items"** entry |

---

## 3. Current state (reference map — so the next chat doesn't re-explore)

### Page & routes
- Page: `app/(app)/downtime/page.tsx` → renders `components/downtime/DowntimePageClient.tsx`.
- Layout: `app/(app)/downtime/layout.tsx`.
- Sidebar: `components/layout/Sidebar.tsx` — `NAV_ITEMS` array of `{ href, labelKey, icon, ownerOnly? }`.
  `/downtime` is hidden when `screenlessMode` is on (Sidebar.tsx ~line 95) and redirected away (~101).

### Current page structure (top → bottom), all in `DowntimePageClient.tsx`
1. **Header card** — title, scope chips (Org / machine / reason / heatmap), **filters row**
   (Today/7D/30D · Minutes/Count · Reset · shift select · planned/unplanned select · microstop input ·
   **Exclude unclassified** button), an ad-hoc **MXN/min** input, Export, Share,
   "Plant select (soon)" (dead placeholder), Back-to-machine.
2. **KPI strip — 8 tiles**: Total downtime, Stops count, Top reason share, **MTBF**, **MTTR**,
   **Availability loss**, Est. impact (MXN), Classification rate.
3. **Hero + breakdown** — Pareto composed chart (bars + cumulative line + 80% reference) with a
   "Top 3 reasons explain X%" callout; reason-breakdown panel (catalog reason menu, top-12 list,
   filtered downtime summary).
4. **Drilldown table** — Reason / Downtime / Stops / Avg duration / % share / Cum %.
5. **Patterns** — day×hour heatmap **+ the Actions & ownership panel** (the task tracker).
6. **Event list (audit trail)** — searchable episode table with Classify/Reclassify buttons.
7. Overlays: `ReasonDrawer` (right drawer) and `ReclassifyModal`.

Sub-components inside the file: `ReasonDrawer`, `KPI`, `Heatmap`, `ActionModal`,
`ActionsOwnershipPanel`, plus the default export.

### Tasks backend (already exists — reuse as-is)
- `GET /api/downtime/actions` — filters all optional: `machineId`, `reasonCode`, `hmDay`, `hmHour`,
  `ownerUserId`, `status`. **With no params it returns all org actions** → perfect for a standalone page.
- `POST /api/downtime/actions` — create.
- `PATCH /api/downtime/actions/[id]` — update (incl. `status` → this is how kanban moves persist).
- `DELETE /api/downtime/actions/[id]`.
- `GET /api/downtime/actions/reminders` — existing reminder route (out of scope here).
- **ActionItem shape**: `id, createdAt, updatedAt, machineId, reasonCode, hmDay, hmHour, title, notes,
  ownerUserId, ownerName, ownerEmail, dueDate, status (open|in_progress|blocked|done),
  priority (low|medium|high)`.
- Members for the owner picker: `GET /api/org/members`.

### i18n already in place (reuse — do NOT recreate)
These keys exist in both `lib/i18n/en.json` and `lib/i18n/es-MX.json` from the i18n pass:
- `downtime.status.{open,in_progress,blocked,done}`
- `downtime.priority.{low,medium,high}`
- `downtime.action.*` (modal fields, save/delete) and `downtime.actions.*` (panel: new, open,
  dueSoon, overdue, untitled, due, noDue, markDone, colAction/Owner/Status, empty, loading…).
- `common.{cancel,close,select,networkError}`.

### No drag-and-drop library is installed (`package.json` has none).

---

## 4. Target information architecture

Split today's single page into **two sidebar tabs**:

```
Sidebar
  Overview
  Machines
  Reports
  Alerts
  Financial (owner)
  Downtime        ← simplified analysis (this revamp)
  Action Items    ← NEW kanban task tracker (moved out of Downtime)
  Methodology
  Settings
```

---

## 5. Page A — "Downtime" (simplified analysis)

Goal: a calm, scannable analysis page. One primary question per screen, secondary detail tucked away.

### 5.1 Header (decluttered)
- Title + one-line subtitle.
- **Primary controls only, left-to-right:**
  - Range segmented control: **Today / 7D / 30D**.
  - **Classification toggle (PROMOTED — solves problem #3):** a clearly labeled segmented control
    `Show: [ All downtime ] [ Classified only ]` with the **Classification rate inline** (e.g.
    "62% classified · target 80%"). This replaces the buried "Exclude unclassified" button and makes
    the data-quality state obvious at a glance.
  - **"More filters" button** → popover/expander holding the secondary filters: machine, shift,
    planned/unplanned, microstop threshold, Minutes/Count metric. Active secondary filters show as
    removable chips under the header (keep the existing scope-chip pattern).
- **Remove:** "Plant select (soon)" (dead), the ad-hoc "MXN/min" input (see 5.2), "Share" (low value;
  keep deep-linkable URL filters which already work). **Keep Export (CSV).**

### 5.2 KPI strip → 5 tiles ("Essentials + cost")
Replace the 8-tile strip with 5, each with a one-line plain-language definition (tooltip/`ⓘ` or a
caption — reuse the `KpiTile`/caption pattern from `components/kpi/KpiTile.tsx`):

| KPI | Definition to show | Source |
|---|---|---|
| **Total downtime** | Total stopped time in range (shift-aware, unplanned) | existing `totalDowntimeMin` |
| **Stops** | Number of distinct stop episodes | existing `stops` |
| **Top reason** | Largest single reason and its share of downtime | `metricRowsAll[0]` |
| **Classified %** | Share of downtime episodes that have a real reason (target ≥80%) | existing `classificationRatePct` |
| **Est. cost (MXN)** | Downtime minutes × the plant's loaded cost/min (machine+operator+energy) | **see note** |

**Est. cost note:** instead of the ad-hoc MXN/min input, source the rate from the configured
financial profile (Settings → Financial) — the same `cost_per_min` the ROI/financial pages use, so the
number is consistent everywhere. If rates are still placeholders/unset, show `—` with a small
"Set cost rates" link to Settings → Financial (mirrors the ROI page's "illustrative only" treatment).
Reuse `lib/reports/roi.ts` `resolveCostPerMin` or `lib/financial/impact.ts`.

**Cut:** MTBF, MTTR, Availability loss (proxies — confusing and not defensible). If we ever want them
back, they belong on a separate "reliability" view with honest definitions, not the headline strip.

### 5.3 Body — a within-page view switch (instead of one long scroll)
A small segmented sub-nav at the top of the body: **Overview · Patterns · Events**.

- **Overview (default):** the Pareto chart + the "Top 3 reasons explain X%" callout + the reason
  breakdown list (cleaned up — drop the dev-ish "From settings or `downtime_menu.md` fallback" caption).
  Optionally fold the Drilldown table here behind a "Show full table" expander.
- **Patterns:** the day×hour heatmap (kept, but on its own view so it's not noise on first load).
- **Events:** the audit-trail episode table with Classify/Reclassify (keep — this is high value and
  where reclassification happens).

### 5.4 Remove the Actions panel from this page
Delete `ActionsOwnershipPanel` usage here — it moves to Page B. Keep `ActionModal`/the action data
hooks reusable (extract, see §7).

### 5.5 Trim dev-placeholder copy (visible to the client today)
Remove or replace: `ReasonDrawer`'s "Investigation (next)" + the 4-bullet "hook these panels later"
list + the "keep this drawer fast" tip; "Patterns — add endpoints later"; "Sortable later". Either
make the drawer show the reason's real recent events, or trim it to the stats it already has.

---

## 6. Page B — "Action Items" (new kanban task tracker)

Route: `app/(app)/action-items/page.tsx` → new `components/actionItems/ActionItemsClient.tsx`.
Reuses `/api/downtime/actions` + `ActionModal` (extracted from the downtime file).

### 6.1 Layout — Kanban board by status
Four columns: **Open · In progress · Blocked · Done** (labels already i18n'd via
`downtime.status.*`). Each **card** shows: title, owner (avatar/initials + name), due date (with an
**OVERDUE**/**due soon** chip), priority pill, and a small linked-context chip (machine / reason) that
deep-links back to `/downtime?machineId=…&reasonCode=…`.

### 6.2 Moving cards between columns (status change)
No DnD library is installed. Two options:

- **Option 1 (recommended for v1, zero deps):** each card has a compact status control — a "Move ▾"
  menu or ◀/▶ arrows — that PATCHes `status`. Fully accessible, trivial, ships fast.
- **Option 2 (enhancement):** real drag-and-drop with `@dnd-kit/core` (+`/sortable`) — small,
  accessible, ~a few KB. Adds a dependency.

Recommendation: **ship Option 1, treat drag as a fast-follow.** Both persist via the existing
`PATCH /api/downtime/actions/[id]`.

### 6.3 Top bar — filters + summary
- Summary tiles: **Open · Due soon (≤3d) · Overdue** (counts; reuse `downtime.actions.*` keys).
- Filters: **Owner** (from `/api/org/members`), **Machine**, **Priority**, and a **"Mine"** quick
  toggle (current user's tasks) — answers "what do *I* have to do". Server supports `ownerUserId`
  + `status` filters; the rest can be client-side.
- **"+ New action"** button → `ActionModal` (create). Cards open the same modal to edit/delete.


### 6.4 "Who has to do what"
Kanban answers flow; add a secondary **"By owner"** view toggle (optional, phase 2) that groups
the same cards under each owner with their open/overdue counts. Keep v1 to the board + owner filter.

### 6.5 Sidebar entry
Add to `NAV_ITEMS` in `components/layout/Sidebar.tsx`:
`{ href: "/action-items", labelKey: "nav.actionItems", icon: ClipboardList }` (lucide
`ClipboardList` or `ListChecks`), placed right after `/downtime`.
- **Visibility decision:** since tasks originate from downtime reasons, gate it under the same
  `screenlessMode` rule as `/downtime` (hide both together). Easy to change later if Action Items
  should be independent.
- New i18n key `nav.actionItems` (EN "Action Items" / ES "Tareas" or "Acciones").

---

## 7. Files to change / add

**Add**
- `app/(app)/action-items/page.tsx` (+ optional `loading.tsx`).
- `components/actionItems/ActionItemsClient.tsx` (board).
- `components/actionItems/ActionCard.tsx`, `ActionColumn.tsx` (or keep inline for v1).
- `components/downtime/ActionModal.tsx` — **extract** the existing `ActionModal` from
  `DowntimePageClient.tsx` so both pages share it. (Also extract the `ActionItem`/`MemberOption`
  types + the save/delete fetch helpers into something like `lib/downtime/actions.ts`.)

**Edit**
- `components/downtime/DowntimePageClient.tsx` — the big simplification: header, 5-KPI strip,
  view switch (Overview/Patterns/Events), remove `ActionsOwnershipPanel`, source cost from financial
  profile, trim placeholder copy. (Consider splitting into smaller files while in here.)
- `components/layout/Sidebar.tsx` — new nav item (+ screenless gating).
- `lib/i18n/en.json` + `lib/i18n/es-MX.json` — new keys (see §8). **Keep both locales in parity.**

**No backend changes expected** — `/api/downtime/actions` already covers list/create/update/delete +
the filters we need. Double-check the GET returns owner display fields (`ownerName`/`ownerEmail`) for
all-org listing (the panel relies on them).

---

## 8. i18n (EN + ES, keep parity)
- **Reuse:** `downtime.status.*`, `downtime.priority.*`, `downtime.action.*`, `downtime.actions.*`,
  `common.*`.
- **Add:** `nav.actionItems`; `actionItems.title/subtitle`, board column headers (or reuse status
  keys), `actionItems.filter.{owner,machine,priority,mine,all}`, `actionItems.empty.{column}`,
  `actionItems.overdue/dueSoon`, `actionItems.linkedContext`.
- **Downtime page additions:** `downtime.view.{overview,patterns,events}`,
  `downtime.classToggle.{all,classifiedOnly,rate}`, `downtime.moreFilters`,
  KPI definition captions, `downtime.cost.setRates` (link text).
- **Remove** the now-unused keys for cut metrics/placeholder copy (MTBF/MTTR/availability subs,
  drawer investigation li1–li4 + tip, patterns.help "add endpoints later", etc.) once their JSX is gone.

## 9. Execution order (phased — each phase is shippable & verifiable)
1. **Extract** `ActionModal` + action types/helpers out of `DowntimePageClient.tsx` (no behavior
   change). Verify the existing downtime page still works.
2. **Build Page B** (`/action-items` kanban, Option-1 status moves) + sidebar entry + i18n. Verify
   create/move/edit/delete persist and filters work.
3. **Simplify Page A**: header + classification toggle, 5-KPI strip (cost from financial profile),
   Overview/Patterns/Events view switch, remove the actions panel, trim placeholder copy, prune i18n.
4. **Polish**: KPI definition tooltips, "Mine" filter, empty states, contrast check (keep ≥ `zinc-400`).
5. *(Optional)* drag-and-drop via `@dnd-kit`.

## 10. Verification
- `npx tsc --noEmit` clean · `npx vitest run` green · i18n key parity script (en ↔ es-MX, 0 missing
  either way) · eslint on changed files (no *new* errors; the file's pre-existing `no-explicit-any`
  debt is known).
- Manual: create an action from a downtime reason, see it on `/action-items`, move it across columns
  (status persists after reload), filter by owner/"Mine", deep-link a card's machine/reason back to
  `/downtime`. Toggle EN/ES — everything flips. Toggle `screenlessMode` — both Downtime and Action
  Items hide together.

## 11. Open questions / risks
- **Cost source for Est. cost KPI:** confirm we want the configured financial `cost_per_min` (not the
  ad-hoc input). Recommended yes (consistency with ROI/financial). If rates unset → `—` + link.
- **Drilldown table fate:** fold under an expander in Overview, or drop? (Recommend: expander.)
- **ReasonDrawer placeholder:** make it show the reason's recent events, or just trim? (Recommend trim
  in this pass; real events list is a separate enhancement.)
- **Action Items visibility under screenlessMode:** tied to Downtime for now — confirm that's desired.
- **Drag-and-drop dependency:** OK to add `@dnd-kit` later, or stay dependency-free? (Recommend v1
  without.)
- `DowntimePageClient.tsx` is huge; consider splitting into `Header`, `KpiStrip`, `ParetoView`,
  `PatternsView`, `EventsView` files while simplifying, to keep it maintainable.
```
