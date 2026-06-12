# Accuracy report — edge counters vs dashboard counts

Generated 2026-06-12T18:44:28.652Z · scope: org 6d2abda2-88e8-4d1d-8f2b-85e2e0d973e5 · read-only

## Methodology
Each work order's **edge good-parts counter** (`MachineWorkOrder.good_parts` — the lifetime total the
Raspberry Pi maintains and shows on the machine's own screen, R1) is compared against the **dashboard
sum** (Σ of that WO's `MachineCycle.goodDelta`, R2 — the basis of every dashboard production number).
R3 says they must agree. Scrap is excluded (it is not recorded per-cycle here — see the per-org note).

## Summary
- Work orders compared: **36** (completed: 0)
- Good-parts edge == dashboard (exact): **55.6%** (20/36)
- ⚠️ **No completed work orders across any org** — WOs do not close in the current edge flow (Phase 6 item). This is a pre-Phase-6 BASELINE: gaps here are the target the edge-reliability work + go-live soak drive to ~100%.

## BEMIS

- Work orders: **36** (completed: 0, open: 36)
- Good-parts edge↔dashboard match: **55.6% exact**, **80.6% within ±1%** (20/36 exact)

> ⚠️ **0 completed work orders.** In the current edge flow WOs never transition to
> COMPLETED, so lifetime counters are still accumulating against open WOs — this is
> a point-in-time snapshot, not a closed-WO reconciliation. Small ±few-part gaps on
> RUNNING WOs are in-flight cycles; large gaps indicate missed cycle ingest. Both
> are addressed by edge reliability (Phase 6: transactional outbox + persistent
> context + WO close).

> ℹ️ **Scrap is not recorded per-cycle** in this deployment (`Σ MachineCycle.scrapDelta = 0`
> for every WO). Scrap lives in the WO counter (`scrap_parts`) and `ReasonEntry`, which is
> what the dashboard sums — so scrap is intentionally omitted from this counter-vs-cycle
> comparison rather than shown as a false disagreement. (Root-cause #5; data-model note.)

| WO | SKU | Status | edge good | Σ cycle good | Δ | match |
|---|---|---|---:|---:|---:|:--:|
| OTBM-002 | Asiento 170 | RUNNING | 59639 | 26752 | 32887 | ⚠️ |
| 230380 | 7T5465368 070 | PENDING | 313 | 3833 | -3520 | ⚠️ |
| 230544 | 7T5465413 070 | PENDING | 349 | 365 | -16 | ⚠️ |
| 1230969 | 7T5466392 070 | PENDING | 397 | 409 | -12 | ⚠️ |
| 230537 | 7T5457993 070 | RUNNING | 1383 | 1394 | -11 | ≈ |
| 230969 | 7T5466392 070 | RUNNING | 179 | 188 | -9 | ⚠️ |
| 230871 | 7T5465367 070 | RUNNING | 606 | 614 | -8 | ⚠️ |
| 230678 | 7T2639949 070 | RUNNING | 1121 | 1129 | -8 | ≈ |
| 230970 | 7t5466371 070 | RUNNING | 627 | 633 | -6 | ≈ |
| 230875 | 7T630058 | PENDING | 902 | 907 | -5 | ≈ |
| 230910 | 7T5458148 070 | PENDING | 159 | 163 | -4 | ⚠️ |
| 230545 | 7T630058 | PENDING | 518 | 521 | -3 | ≈ |
| 230876 | 7T630240 | PENDING | 621 | 618 | 3 | ≈ |
| 230897 | 7T5457993 | PENDING | 132 | 131 | 1 | ≈ |
| 230825 | 7T5458161 070 | PENDING | 3692 | 3691 | 1 | ≈ |

_match: ✅ exact · ≈ within ±1% (in-flight) · ⚠️ gap > 1% (missed ingest)_

---
_Reproduce: `node scripts/verify-edge-vs-dashboard.mjs --orgId 6d2abda2-88e8-4d1d-8f2b-85e2e0d973e5`. See `docs/verification/ACCURACY_REPORT_TEMPLATE.md` for how to read this report._
