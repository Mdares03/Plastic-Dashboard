# Phase 3 — financial impact: R5 cap (#13, partial) (2026-06-11)

`lib/financial/impact.ts` (financial dashboard + ROI inputs). `computeFinancialImpact`
derives micro/macrostop **downtime cost** from `MachineEvent` `stoppage_duration_seconds`
and multiplied them **uncapped**. The events table holds many runaway stoppages —
**69,134 macrostop events > 12 h, max ≈ 67.6 h** (the same never-resolved / clock-skew
artifact Phase 2 cleaned out of `ReasonEntry`, but events were never cleaned). Those
flowed straight into cost.

## Change (R5 cap)

Cap each micro/macrostop stoppage at `MAX_OPEN_EPISODE_MS` (12 h) before costing —
the same open-episode cap recap/reports/losses/analytics use. No API/UI change.

## Verification (local prod DB, 30 d, BEMIS, 4805 events costed)

| | total | macrostop | microstop |
|---|-------|-----------|-----------|
| before (uncapped) | MXN 27 661 | 5 643 | 19 444 |
| after (12 h cap) | **MXN 24 867** | **2 850** | 19 444 |

The cap removes ~2 793 MXN/30 d — it **halves** the macrostop cost, which was
inflated by runaway 12–67 h "stoppages". Microstops are unaffected (max 0.3 h).

## KNOWN RESIDUAL — downtime source (needs a product decision, NOT done here)

R5 says `ReasonEntry` is the only downtime source and `MachineEvent` is for live
state/alerting only. This module still **sources downtime cost from the event
stream**, so cost minutes can differ from the dashboard's `ReasonEntry`-based
downtime minutes. Re-basing onto `ReasonEntry` is non-mechanical:

- The API/UI exposes `slowCycle / microstop / macrostop / scrap` cost categories;
  `ReasonEntry` downtime rows carry domain reason codes (UNCLASSIFIED, MOLD_CHANGE,
  DTMTO-*, …) with **no micro/macro split**, so re-basing forces either a UI change
  (collapse to one "downtime cost") or an event→episode join to keep the split.
- Scrap cost currently comes from `quality-spike` events, not `ReasonEntry` kind
  `scrap` (an R2-scrap source question).

Flagged for the user; tracked in the reliability-overhaul memory and the Phase 7
ROI-model work (which must use the same downtime number the dashboard shows).

`npm test` (32 golden tests) green; `tsc --noEmit` clean.
