# ROI model — downtime reduction

> The number we measure the "20% downtime reduction" against is **the same number the dashboard
> shows.** Since the #13 re-base, the financial page, the recap/reports downtime, and this model all
> read one source — `ReasonEntry` via `computeDowntime`/`episodeWindowMinutes` (METRICS_SPEC R5). They
> cannot disagree by construction.

## 1. The measured baseline (real)

Generated from the cleaned production data (BEMIS, 30 days to 2026-06-12, 2 machines):

| Quantity | Value | Source |
|---|---:|---|
| Total downtime | 10,180 min (169.7 h) | `computeDowntime.totalMin` |
| Planned (mold change) | 2,277 min (38.0 h) | `computeDowntime.plannedMin` |
| **Unplanned downtime** | **7,904 min (131.7 h)** | `computeDowntime.unplannedMin` |

Reproduce: `npx dotenv -e .env -- tsx scripts/metrics/financial-rebase-check.ts <orgId> 30`.

**The reduction target applies to *unplanned* downtime** — planned changeovers are necessary, not a
loss to chase. Baseline ≈ **65.9 h / machine / month** of unplanned stoppage.

## 2. The formula

```
monthly_savings = reduction_fraction × unplanned_downtime_min × cost_per_min
```

- `reduction_fraction` — the improvement target (0.20 for the 20% goal).
- `unplanned_downtime_min` — measured each month by the exact query above (congruent with the dashboard).
- `cost_per_min` — the org's loaded cost of a stopped machine per minute = `machineCostPerMin +
  operatorCostPerMin + energyCostPerMin` from `OrgFinancialProfile` (+ machine/location overrides).

At the 20% target: `0.20 × 7,904 = 1,581 min/month` (26.3 h/month) of stoppage removed across the 2
machines.

## 3. Money conversion — needs the client's real rates

> ⚠️ **The cost rates in `OrgFinancialProfile` for this org are still placeholders (all = 1 MXN/min).**
> Until they are set to the plant's real numbers, every money figure below is **illustrative only**.
> The downtime *minutes* are real and measured; the peso conversion is not, yet.

Set the real rates in **Settings → Financial** (or `OrgFinancialProfile`): machine cost/min, operator
cost/min, energy cost/min, scrap cost/unit. The model and the financial page then update automatically —
no recomputation, no second source.

Illustrative monthly savings at the 20% target (1,581 min/month removed), by loaded `cost_per_min`:

| cost_per_min (MXN) | Monthly savings (MXN) | Annual (MXN) |
|---:|---:|---:|
| 20 | 31,600 | 379,000 |
| 40 | 63,200 | 759,000 |
| 60 | 94,800 | 1,138,000 |

_Replace with one row once the real `cost_per_min` is entered; the math is linear in the rate._

## 4. How we track it (monthly)

1. Run the same `computeDowntime` window each month (or read the financial page / consistency health
   endpoint — all the same number).
2. Compare unplanned minutes vs the 7,904 min/month baseline.
3. `reduction_achieved = (baseline − current) / baseline`. Target: ≥ 0.20 sustained.
4. Money = `reduction_min × cost_per_min` at the org's real rate.

Because the baseline, the monthly figure, and the dashboard all come from the **same authority**, the
client can verify the ROI number on their own screen at any time — that is the whole point of the
rebuild.

## 5. Caveats (stated, not hidden)

- **Edge capture gaps.** The accuracy report (`docs/verification/ACCURACY_REPORT_*.md`) shows good-parts
  capture at ~56% exact / ~81% within ±1% today; downtime episodes can likewise be missed if the edge
  drops messages. Phase 6 (transactional outbox + persistent context) tightens capture, which makes the
  baseline itself more trustworthy. The baseline should be re-confirmed after the Phase 6 deploy + the
  go-live soak.
- **Window.** Baseline is a 30-day rolling window; seasonality (product mix, shift count) will move it.
  Track the trend, not a single month.
