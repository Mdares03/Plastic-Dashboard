# Accuracy report — how to run and read it

The accuracy report is the client-facing proof that **the number on the machine's own screen and
the number on the dashboard are the same number.** It is generated, not asserted.

## Run it

```
node scripts/verify-edge-vs-dashboard.mjs                  # all orgs
node scripts/verify-edge-vs-dashboard.mjs --orgId <id>     # one org
node scripts/verify-edge-vs-dashboard.mjs --out report.md  # custom path
```

Output: `docs/verification/ACCURACY_REPORT_<YYYY-MM-DD>.md`. Read-only (only `findMany` / `groupBy`).

## What it compares (R1 ↔ R2, the R3 invariant)

| Side | Source | Spec | Meaning |
|------|--------|------|---------|
| Edge counter | `MachineWorkOrder.good_parts` | R1 | The lifetime good-parts total the Raspberry Pi maintains and shows on its own home screen. |
| Dashboard sum | `Σ MachineCycle.goodDelta` for the WO | R2 | The per-cycle deltas every dashboard production number is built from. |

**R3 says these must be equal.** The report shows the gap per WO; it never silently reconciles them
(that silent `max()`-style reconciliation was a root cause of the pilot's lost trust).

## How to read a row

| Symbol | Meaning |
|--------|---------|
| ✅ | Exact match — edge counter == dashboard sum. |
| ≈ | Within ±1% (or ±2 parts) — a RUNNING WO with a few in-flight cycles between the counter tick and the cycle row. Not a defect. |
| ⚠️ | Gap > 1% — cycles the edge counted but never delivered as `MachineCycle` rows (missed ingest). A real edge-reliability finding. |

## Known caveats this report makes explicit

- **0 completed work orders.** WOs never transition to `COMPLETED` in the current edge flow, so every
  figure is a point-in-time snapshot of an open, still-accumulating WO — not a closed reconciliation.
  Closing WOs on the edge is a Phase 6 (edge reliability) item.
- **Scrap is not per-cycle.** `Σ MachineCycle.scrapDelta` is 0 for every WO; scrap is tracked in the WO
  counter (`scrap_parts`) and `ReasonEntry`, which is what the dashboard sums. Scrap is therefore
  excluded from the comparison rather than shown as a false disagreement.

## Interpreting the trend

A report run **today** is the pre-Phase-6 **baseline**. The edge-reliability work (transactional
outbox so no cycle is lost on a crash, persistent context across reboots, and WO close) plus the
go-live soak are what drive the exact-match number toward ~100%. Re-running this report after each
edge deploy is the evidence that it did — the same generator, the same numbers, every time.
