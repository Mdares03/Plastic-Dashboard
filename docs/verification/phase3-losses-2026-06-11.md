# Phase 3 — losses.ts downtime migration (#9) (2026-06-11)

`lib/reports/queries/losses.ts` (Reports → top losses, downtime-by-reason
Pareto, downtime cost). It summed raw `durationSeconds / 60` per `ReasonEntry`
with **no window clamp and no 12 h cap** — an R5 violation: an episode whose end
runs past the report window, or a runaway/open episode, contributed its full
length.

## Change

Exposed the R5 per-episode rule as `episodeWindowMinutes(row, start, end)` in
`lib/metrics/downtime.ts` (the same clamp + 12 h cap `computeDowntime` uses,
factored out so per-row/per-machine-cost callers share it). `losses.ts` now
computes each episode's minutes through it (and skips zero-overlap rows). The
losses-specific planned-shift filter (`isInPlannedShift`) and per-machine cost
loop are unchanged — losses remains "downtime within planned production time",
now with congruent per-episode minutes.

## Verification (local prod DB, 30 d, planned-shift-filtered)

| org | reasons | before (raw) | after (R5) | Δ | episodes clamped |
|-----|---------|--------------|------------|---|------------------|
| BEMIS | 973 | 8502 min | 8502 min | 0 | 0 |

Identical on current data — Phase 2 already clamped the two runaway episodes and
the stored `durationSeconds` are within bounds, so nothing needs clipping today.
The value is structural: the clamp/cap is now enforced by the single R5 authority,
so any future window-spanning or open episode is clipped here exactly as it is in
recap/reports — losses can no longer drift above the dashboard's downtime number.

`npm test` (32 golden tests) green; `tsc --noEmit` clean.
