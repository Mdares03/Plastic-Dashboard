# Phase 3 — Recap migration diff (2026-06-11)

`getRecapData.computeRecap` migrated onto `lib/metrics` (R4 rates, R5 downtime).
Diff isolates the **code change only**: baseline `baseline-2026-06-11.json` was
captured with the old recap code against already-cleaned data (post Phase 2), so
the deltas below are purely the R4/R5 swap, not the data cleanup.

Command: `npx dotenv -e .env -- tsx scripts/metrics/recap-diff.ts docs/verification/baseline-2026-06-11.json`

| window | machine | oee | downtimeMin | goodParts |
|--------|---------|-----|-------------|-----------|
| 7d  | M4-2 | 39.5 → 43.84 (+4.34) | 450.1 → 450.1 (0) | 5700 (0) |
| 7d  | M4-5 | 70.98 → 77.57 (+6.59) | 2510.38 → 2505.6 (−4.78) | 1920 (0) |
| 30d | M4-2 | 43.08 → 44.42 (+1.34) | 1909.2 → 1882.2 (−27) | 26752 (0) |
| 30d | M4-5 | 74.69 → 76.75 (+2.06) | 8789.8 → 8789.8 (0) | 11877 (0) |

**4 machine×window cells changed; every change is R-rule-justified:**

- **OEE rises (R4).** Window rates now average only `trackingEnabled &&
  productionStarted` snapshots, each weighted ≤10 min. The old `weightedAvg` time-
  weighted *all* snapshots, so tracking-off / pre-production samples (low or zero
  OEE) dragged the average down. Removing them raises OEE — the number now means
  "OEE while actually producing," which is what the tile claims.
- **Downtime falls slightly (R5).** `computeDowntime` clamps each episode to its
  overlap with the window and caps it at 12 h, and the `max(eventSum, reasonSum)`
  double-authority is gone. The −27 min on M4-2/30d is the clamped tail of the
  runaway episodes near the window edge.
- **goodParts unchanged.** Production counting (R2 cycle deltas) was not part of
  this call site's change; identical values confirm no collateral drift.

`npm test` (30 golden tests) green; `tsc --noEmit` clean.

---

## production.ts — R2 lifetime-vs-window fix (#8)

`getProductionVsTarget` previously summed **lifetime** `MachineWorkOrder.goodParts`
for every WO whose `updatedAt` fell in the window. Now `good` = deduped in-window
`MachineCycle` goodDelta (`windowProduction`); `target` = `targetQty` of WOs that
actually ran cycles in the window.

| org/window | good (before→after) | target | pct |
|---|---|---|---|
| BEMIS yesterday | 563 → 209 | 720 → 720 | 78.2 → 29 |
| BEMIS 7d | 61925 → **7620** | 111510 → 103410 | 55.5 → 7.4 |
| BEMIS 30d | 71763 → 38629 | 131213 → 113663 | 54.7 → 34 |

**Congruence proof:** the 7d `good` of **7620 = 5700 (M4-2) + 1920 (M4-5)** — the
exact per-machine production recap reports for the same window. Reports and Recap
now return the *same* production number; the old 61925 was lifetime totals leaking
into a 7-day view.

**Flagged decision (target semantics):** `good` is in-window but `target` is the
lifetime WO goal, so weekly pct reads low for multi-week WOs. This is honest (no
inflation) but the "Production vs Target" tile may want either a prorated target or
a relabel to "in-window output vs WO goal". Deferred to the UI-label pass — the
data is now correct and congruent.

---

## reports/oee.ts (#7) + oeeTrend.ts (#10) — R4 time-weighting + R7 null gaps

`getOeeSnapshot` plain-averaged snapshots (the path that disagreed with Recap's
time-weighted average); now uses `computeWindowRates` (R4) per machine and for the
org roll-up. `getOeeTrend7d` plain-averaged per day and emitted **0** for empty
days; now time-weights each day (R4) and emits **null** gaps (R7) — the chart
tooltip shows "—" and recharts gaps the line instead of faking a drop to 0%.

**Congruence proof — Reports OEE now == Recap OEE, to the decimal:**

| window | machine | Reports OEE (before→after) | Recap OEE | |
|---|---|---|---|---|
| 7d  | M4-2 | 43.9 → 43.84 | 43.84 | ✓ |
| 7d  | M4-5 | 77.9 → 77.57 | 77.57 | ✓ |
| 30d | M4-2 | 44.4 → 44.42 | 44.42 | ✓ |
| 30d | M4-5 | 77.0 → 76.75 | 76.75 | ✓ |

The same KPI on two screens is now produced by one function (`computeWindowRates`),
so they cannot disagree. `tsc` clean; 30 golden tests green.
