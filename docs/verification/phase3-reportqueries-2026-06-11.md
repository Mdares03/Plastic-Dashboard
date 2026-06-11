# Phase 3 — report-query migrations (#11) (2026-06-11)

Four secondary Reports queries. Two carried R-rule violations; two were reviewed
clean.

## downtimeByShift.ts — R5

Summed raw `durationSeconds / 60` per shift (no clamp, no 12 h cap). Now uses the
shared `episodeWindowMinutes(row, from, to)` — identical R5 authority as
recap / reports / losses (fetch now selects `episodeEndTs`). Behaviourally
identical to losses' migration, which measured **0 delta** on current
(Phase-2-cleaned) prod data; the clamp/cap is now enforced for any future
window-spanning or open episode.

## scrapTopSkus.ts — R2

`scrapUnits` already came from `ReasonEntry` (correct manual-scrap source). Only
the scrap-% denominator (`totalUnits`) summed cycle deltas **without dedup**. Now
dedupes cycle rows per machine via the shared `dedupeCycles` so the denominator
matches the production report's good+scrap counts.

## cyclePerformance.ts — R2

`unitsProduced` summed cycle deltas without dedup. Now dedupes per machine via
`dedupeCycles` before aggregating. (`dedupeCycles` was made generic so callers
keep their richer row type.)

## classificationRate.ts — reviewed, no change

Computes a ratio of classified vs total **stop episodes** (counted by
`episodeId`), not a duration or production sum. No R-rule applies; left as-is.

## Cycle-dedup impact

Direct SQL on prod: `0` duplicate `(machineId, ts, cycleCount)` groups in
`MachineCycle`, so the dedup changes no number today. It is required by R2 ("in-
window = *deduped* cycle deltas") and makes these reports congruent **by
construction** with the production report under any future edge/outbox duplicate
(which Phase 6 separately hardens).

`npm test` (32 golden tests) green; `tsc --noEmit` clean.
