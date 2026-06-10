# Handoff — BEMIS Meeting Feedback

**Date:** 2026-05-14
**Owner:** Marcelo (MALIOUNTECH)
**Stack touched:** Control Tower (Next.js/Prisma/Postgres) + Pi edge (Node-RED/MariaDB)
**Out of scope:** Paro micro/macro merge — BEMIS still deciding.

---

## WI-1 — Preview card parity + scrap source of truth

### Goal
Both cards (Daily Recap + Machines tab) show the same operational picture:
**mold · good pieces · scrap · stops · WO**. Scrap value must match between
views.

### Current state
- `RecapMachineCard.tsx` shows good / scrap / stops / WO — **no mold**.
- `MachinesClient.tsx` shows only status + last-seen — **no good / scrap /
  stops / WO / mold**.
- Scrap value disagrees between views.

### Root cause of scrap disagreement (confirmed)
| View          | Source                                             | Behavior                                              |
| ------------- | -------------------------------------------------- | ----------------------------------------------------- |
| Machines tab  | `MachineKpiSnapshot.scrap` (latest)                | WO running total — reflects manual entries ✅          |
| Daily Recap   | `Σ MachineCycle.scrapDelta` over range             | Per-cycle deltas only — **misses all manual scrap** ❌ |

Pi-side `scrap-entry-with-reason` (Work Order buttons node) does two things:
1. `UPDATE work_orders SET scrap_parts = scrap_parts + ?` → eventually feeds
   the KPI snapshot.
2. Emits a separate event `eventType: "scrap-manual-entry"` with `scrapDelta`
   → lands as a `MachineEvent` and/or `ReasonEntry`, **not** as a cycle row.

So manual scrap never enters `MachineCycle.scrapDelta`. Recap window can show
0 while Machines shows the correct WO total.

### Fix — Control Tower side
**In `lib/recap/getRecapData.ts`** extend the scrap aggregation to include
manual scrap:

- Already queries `prisma.reasonEntry.findMany(...)` for downtime (line
  ~334). Add a sibling query for `kind: "scrap"` over the same range, or
  widen the existing query and split by `kind`.
- In the aggregation loop, after summing `cycle.scrapDelta`, also add the
  sum of `reasonEntry` rows (kind=scrap) into `scrapParts` per machine /
  per WO / per SKU.
- Keep `MachineCycle.scrapDelta` as the source for auto/cycle scrap so
  nothing double-counts (manual entries don't write cycles; cycles
  don't carry manual scrap).

**Decide single source for the Machines card** (recommend: same path as
recap, so both views agree). Two options:
- (preferred) Have the machine card fetch a small "today / WO" aggregate
  endpoint that runs the same logic as recap restricted to the active WO.
- Keep `KpiSnapshot.scrap` for the Machines card but verify the Pi-side
  `scrap_parts` field stays in sync with what the recap query computes.

### Fix — mold on cards
- `MachineWorkOrder.mold` already exists (`api/work-orders/machines/[id]`
  returns it).
- On both cards, the active WO lookup needs to also expose `mold`.
- Recap path: in `getRecapData.ts` where `activeWorkOrderId` is resolved,
  also pull `mold` from `MachineWorkOrder` and surface it in the
  `RecapSummaryMachine` shape.
- Machines tab: `app/api/machines` (the list endpoint that backs
  `MachinesClient`) currently returns just `id/name/code/location/
  latestHeartbeat/latestMacrostop`. Extend it to include the active WO
  `{ workOrderId, sku, mold, target, scrapParts, goodParts, cycleTime }`.

### Files touched
- `lib/recap/getRecapData.ts` — scrap aggregation, mold on summary
- `lib/recap/types.ts` — add `mold` to `RecapSummaryMachine`
- `components/recap/RecapMachineCard.tsx` — render `mold`
- `app/api/machines/route.ts` — include active WO + mold + good/scrap
- `app/machines/MachinesClient.tsx` — render mold/good/scrap/stops/WO
- (maybe) `lib/machines/withLatest.ts` — extend merge to carry WO fields

### Card content spec (both cards)
| Field          | Recap (24h)                     | Machines (WO total)             |
| -------------- | ------------------------------- | ------------------------------- |
| Status         | running / stopped / idle / etc. | same                            |
| WO             | active WO id                    | active WO id                    |
| Mold           | active WO mold                  | active WO mold                  |
| SKU / PN       | active WO sku                   | active WO sku                   |
| Good pieces    | Σ over 24h                      | WO running total                |
| Scrap          | Σ over 24h (incl. manual)       | WO running total (incl. manual) |
| Stops count    | over 24h                        | over WO duration                |
| OEE %          | weighted over 24h               | latest snapshot                 |

### Acceptance
- Manager opens Recap → scrap number matches Machines card for the same
  machine (within the recap window, accounting for older WO history).
- Both cards show mold.
- Manual scrap entries from Pi HMI are visible in the next recap refresh.

### Verification
```
npx tsc --noEmit
npm run build
sudo systemctl restart mis-control-tower
```
Spot check: enter scrap via Pi HMI, wait <60s, refresh recap, confirm
delta visible.

---

## WI-2 — Scrap input: numpad-only on Pi HMI

### Goal
Operator types the numeric scrap code on a numpad. No catalog browsing.
The resolved code (e.g. `MX003`) plus its label appears in the Control
Tower.

### Current state
- `Work Order buttons` node (id `204c7a49f98a9944`), case `scrap-open`:
  sends `msg.scrapPrompt = { ..., reasonCatalog: <full catalog> }` to the
  HMI.
- HMI renders a category > detail picker.
- On submit it routes to `scrap-entry-with-reason` which calls
  `normalizeReason(payload, "scrap")` and stores `categoryId / detailId /
  categoryLabel / detailLabel`.

### Fix — Pi side
1. In `scrap-open`, replace the catalog dump with a flag:
   ```js
   msg.scrapPrompt = {
       ...,
       inputMode: "numpad",
       codePrefix: "MX",     // or pull from settings
       reasonCatalog: null   // do NOT ship the catalog
   };
   ```
2. Update the HMI scrap prompt UI (Node-RED dashboard or kiosk page):
   show numeric keypad, display `MX___` as the operator types digits.
3. On submit, resolve locally via `settings.reasonCatalog`:
   ```js
   // pseudo, in Work Order buttons or a small helper node
   const code = `MX${digits.padStart(3, "0")}`;
   const found = findCatalogReasonByReasonCode(
       settings.reasonCatalog, "scrap", code
   );
   if (!found) {
       // emit error to HMI: "Código no encontrado"
       return null;
   }
   msg.payload = {
       id: activeOrder.id,
       scrap: scrapNum,
       reasonPath: [
           { id: found.categoryId, label: found.categoryLabel },
           { id: found.detailId,   label: found.detailLabel }
       ],
       reasonType: "scrap"
   };
   // route to scrap-entry-with-reason — payload shape is already what
   // normalizeReason expects, no Control Tower changes needed
   ```
4. Settings → make sure the Pi has a fresh `reasonCatalog` (already does
   via `Fetch settings from Control Tower`).

### Fix — Control Tower side
- Nothing structural. The `Ingest /api/ingest/reason` handler already
  accepts the resolved reason. Verify it normalizes through
  `findCatalogReasonByReasonCode` so the displayed label is the catalog
  label, not whatever the Pi sent.

### Files touched
- Pi: `flows(68).json` — `Work Order buttons` (scrap-open case + a new
  resolver helper or inline). HMI dashboard tab for scrap prompt.
- (verify) `app/api/ingest/reason/route.ts` — confirm label resolution
  via `findCatalogReasonByReasonCode`.

### Acceptance
- Operator opens scrap prompt → sees numeric keypad, no category list.
- Types `001`, submits → Control Tower shows `MX001 · Usadas en prueba
  de agua`.
- Unknown code → HMI shows error, no entry recorded.

### Verification
- Deploy flow → register scrap of 5 with code `001` on Pi HMI.
- Query Control Tower: `SELECT * FROM "ReasonEntry" WHERE kind='scrap'
  ORDER BY "capturedAt" DESC LIMIT 5;`
- Confirm `reasonCode = 'MX001'` and `reasonLabel` matches catalog.

---

## WI-3 — Downtime reason: show label, not "procesos > 13"

### Goal
Stop entries display the catalog **label** (e.g. `Procesos > Falla
hidráulica`) instead of the operator's raw input number
(`Procesos > 13`).

### Current state
- Operator enters a number on Pi HMI.
- That number is stored as `detailId` in the reason payload.
- Render layer in Control Tower is using `detailId` (or
  `detailLabel === detailId`) instead of resolving through the catalog.

### Root cause hypothesis
The `Work Order buttons` `normalizeReason()` builds:
```js
{ type, categoryId, categoryLabel, detailId, detailLabel, ... }
```
from `payload.reasonPath`. If the Pi HMI submits the raw number as both
`detailId` and `detailLabel`, the Control Tower stores it verbatim. The
resolver `findCatalogReasonByReasonCode` is never called to get the real
detail label.

### Fix
Same pattern as WI-2: resolve on Pi before emitting, or resolve in
Control Tower on render.

**Recommended: Control Tower side, on render** — guarantees historical
records also display correctly even if Pi forgot to resolve.

1. Wherever `ReasonEntry.reasonCode` is read for display (alerts inbox,
   downtime panel, recap stops list, etc.), pass it through
   `findCatalogReasonByReasonCode(catalog, "downtime", reasonCode)` and
   prefer `reasonLabel` over `detailLabel` from the stored row.
2. For new entries: on Pi, before emitting, run the same resolver against
   `settings.reasonCatalog` so the stored `detailLabel` is already
   correct.

### Files touched
- (find) UI components rendering downtime reason strings — likely under
  `components/alerts/`, `components/recap/`, machine detail pages.
- (find) Pi: `Work Order buttons` `normalizeReason` — add catalog
  resolution before emitting.

### Acceptance
- Existing entries with `reasonCode = DTPRC-13` render as
  `Procesos > Falla hidráulica` (or whatever DTPRC-13 maps to) instead
  of `Procesos > 13`.
- New entries write a resolved `detailLabel` so even without the
  render-time resolver the display is correct.

### Verification
```sql
SELECT "reasonCode", "categoryLabel", "detailLabel", "reasonLabel"
FROM "ReasonEntry"
WHERE kind = 'downtime'
ORDER BY "capturedAt" DESC
LIMIT 20;
```
- Visually compare `detailLabel` (raw) vs `reasonLabel` (resolved) in
  the UI.

---

## Pending — Paro micro/macro merge

BEMIS still deciding. Implementation note for when they do:
- Presentation-only collapse (single "Paro" label in UI, drop micro/macro
  distinction) is the safe path.
- **Do not** collapse at the data model — OEE math depends on cycle-gap
  (1.5× ideal) for performance vs availability separation. Keep
  classification internal, hide from operator/manager view.

---

## Reference — files reviewed for this scope

| File                                                      | Used for                                                |
| --------------------------------------------------------- | ------------------------------------------------------- |
| `lib/recap/getRecapData.ts`                               | Scrap source-of-truth diagnosis                         |
| `app/api/recap/route.ts`                                  | Entrypoint to recap data                                |
| `app/api/machines/[machineId]/route.ts`                   | Machine card scrap source (KpiSnapshot)                 |
| `app/api/work-orders/machines/[machineId]/route.ts`       | Mold lives on `MachineWorkOrder.mold`                   |
| `app/machines/MachinesClient.tsx`                         | Card render target (no scrap/mold/good today)           |
| `components/recap/RecapMachineCard.tsx`                   | Card render target (no mold today)                      |
| `lib/machines/withLatest.ts`                              | KpiSnapshot has no mold; needs WO join                  |
| `lib/reasonCatalog.ts`                                    | `findCatalogReasonByReasonCode` — already does the job  |
| `flows(68).json` — Work Order buttons                     | Scrap entry cases, downtime reason normalization        |
| `flows(68).json` — Build Reason HTTP                      | `/api/ingest/reason` payload                            |