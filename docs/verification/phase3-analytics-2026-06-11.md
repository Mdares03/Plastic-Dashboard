# Phase 3 — analytics downtime routes (#14) (2026-06-11)

The analytics dashboard's downtime numbers (`/api/analytics/pareto`,
`/coverage`, `/downtime-events`) summed raw `durationSeconds` — no window clamp,
no 12 h cap. A client comparing the analytics pareto total against the recap /
reports downtime number could see them disagree (the exact trust complaint).

## Changes (all R5)

- **pareto/route.ts** — totals (`totalMinutesAll`/`Classified`) and the
  per-reason buckets now use `episodeWindowMinutes(row, start, now)`: each
  episode contributes its overlap with the rolling window, capped at 12 h. The
  planned/shift/microstop filters still operate on the raw row (episode
  *classification* is unchanged; only the summed magnitude is R5-clamped).
  Fetch selects `episodeEndTs`.
- **coverage/route.ts** — `receivedMinutes` now window-clamped + capped the same
  way.
- **downtime-events/route.ts** — per-episode list: displayed `durationSeconds` /
  `durationMinutes` capped at `MAX_OPEN_EPISODE_MS` (12 h). Real `startAt`/`endAt`
  timestamps left as recorded (a list shows real episodes, not window slices).

## Verification (local prod DB, raw vs R5)

| window | org | rows | before | after | Δ |
|--------|-----|------|--------|-------|---|
| 7d | BEMIS | 138 | 2882.5 min | 2882.5 min | 0 |
| 30d | BEMIS | 973 | 10391.2 min | 10391.2 min | 0 |

Zero delta on current (Phase-2-cleaned) data — no episode spans a window start or
exceeds 12 h today. The R5 authority is now the single source for the analytics
downtime numbers, so they stay congruent with recap/reports under any future
window-spanning or runaway episode.

(The 30d analytics total 10391 vs losses' 8502 is the planned-shift filter losses
applies and analytics does not — an intentional, documented scoping difference.)

`npm test` (32 golden tests) green; `tsc --noEmit` clean.
