# Phase 7 (#13) — financial downtime cost re-based onto ReasonEntry

Org: **BEMIS** (`6d2abda2-88e8-4d1d-8f2b-85e2e0d973e5`) · window: last 30d · generated 2026-06-12T18:31:49.013Z

## Congruence proof (R5)
Financial downtime cost is now computed from the **same ReasonEntry rows + episodeWindowMinutes**
as the dashboard. So the minutes the financial module charges == the dashboard's UNPLANNED
downtime minutes. (Planned/MOLD_CHANGE downtime is excluded from cost — necessary, not a reducible loss.)

| Quantity | Minutes |
|---|---|
| computeDowntime totalMin (incl. planned) | 10178.4 |
| computeDowntime plannedMin | 2274.8 |
| computeDowntime unplannedMin | 7903.6 |
| manual unplanned (independent recompute) | 7903.6 |
| **financial downtime cost-minutes** | **7903.6** |
| Δ (financial − unplanned) | 0 |

**Congruent: ✅ YES** (|Δ| < 0.5 min)

## Financial totals (re-based)
  MXN: total=26284.5 micro=5.05 macro=23705.75 slow=2515.7 scrap=58

Downtime episodes charged: 949 of 971 ReasonEntry downtime rows
(difference = planned + zero-overlap + zero-cost episodes).

## Interpretation (vs the old event-sourced number)
Before #13, downtime cost was derived from `MachineEvent` micro/macrostop rows (with a 12h cap,
Phase 3 commit 3c343f6). That source silently **undercounted**: it skipped `status:"active"` and
duration-less stoppages, so the reported macrostop cost was far below the downtime the dashboard
actually showed. Re-basing onto ReasonEntry makes cost = (dashboard downtime minutes × idle rate),
so the financial page and the OEE/downtime views can no longer disagree.

Note micro ≈ 0: ReasonEntry holds operator/edge-classified downtime **episodes**, which are
overwhelmingly macro (>120s). Sub-minute microstops are a performance loss
captured by OEE/slow-cycle, not by the downtime authority — so they no longer appear as a separate
"microstop cost". This is the correct R5 behavior.
