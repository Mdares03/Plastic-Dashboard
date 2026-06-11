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
