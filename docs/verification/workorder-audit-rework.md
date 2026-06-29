# Work-order audit rework — verification exhibit

**Date:** 2026-06-24 · **Org:** bemis-2 (`6d2abda2-…`) · **Branch:** reliability-overhaul
**Regenerate:** `npx dotenv -e .env -- tsx scripts/workOrders/recon-verify.ts`

## Problem

The Work Orders tab showed a wall of red **"Mismatch ✗"** badges. A single audit
(`activeCavities × cyclesCounted = good + scrap`) fired on three unrelated conditions:
benign scrap, lost-in-transit cycle rows, and a genuinely wrong counter. A plant manager
read it as "the system doesn't work," with no way to clear it.

## Change

The badge is split into two correctly-baselined checks (`lib/workOrders/reconciliation.ts`,
pure `deriveWorkOrderAudit`):

- **Counter integrity (`countOk`)** — the only RED for a real mis-count. `cavities ×
  the WO's own cycle_count ≈ goodParts`, scrap tolerated, rounding slack. Skipped when
  cavities are unknown or cycle_count wasn't propagated (< delivered rows).
- **Delivery completeness (`delivery`)** — missing = cycles the machine ran that never
  reached the cloud. Classified `explained` (sensor-outage overlap or acknowledged) /
  `recoverable` (open + live) / `unexplained` (the rare, real, alert-worthy case).
- **Scrap never flags a job on its own.**

## Result (36 work orders)

| Classification | Count | Tone |
|---|---|---|
| counter error | **0** | red |
| unexplained gap | **7** (8,238 cycle rows) | red |
| catching up | 0 | amber |
| explained gap | 1 | amber |
| reconciled | **28** | green |

The eight rows from the screenshot:

```
job           cav  rep_cyc  delivered  good  scrap  countOk  missing  delivery
OT-TEST-CAV     2      186        155   372      0     true       31  explained
230982          1      762        761   762      0     true        1  unexplained
230876          1      621        618   621      0     true        3  unexplained
230875          1        0        907   902      6     true        0  none        ← was red (scrap only)
230969          1       12        188   179     11     true        0  none        ← was red (scrap only)
230897          1      132        131   132      2     true        1  unexplained
230910          1        0        163   159      6     true        0  none        ← was red (scrap only)
230825          1     3694       3691  3692      2     true        3  unexplained
```

- **0 counter errors** — no machine actually mis-counted; every former "mismatch" was
  scrap noise or a delivery gap.
- **Scrap-only rows go green** (230875/230910/230969).
- **OT-TEST-CAV auto-explained** — its active span overlapped recorded `reader_online=false`
  heartbeats (sensor outage), so the 31-row gap is attributed, not flagged.
- The remaining **7 unexplained gaps (8,238 rows)** are the genuine outbox-freeze losses.
  The one-click **Accept known outage** fix (`/api/health/fix/cycle-backfill`, surfaced by
  the `cycle_delivery` health check) acknowledges them as a one-time baseline → board goes
  fully green. A NEW unexplained gap after that trips `cycle_delivery` to **fail** (the
  Verified-badge / Trust-card emergency surface).

## Known limitation

Sensor-outage auto-explain uses overlap of the WO's `[createdAt, updatedAt]` span with any
recorded outage heartbeat. A very long-running WO (e.g. the OT-TEST-CAV test job spanning
~2 months) will overlap almost any outage and so auto-explains broadly. For normal-length
WOs this is precise; abnormally long jobs could mask a gap. Acceptable for the pilot; revisit
with per-cycle-timestamp gap localization if needed.

## Deferred

Email-on-new-gap through the event-driven alert engine (`lib/alerts/engine.ts`) is NOT wired
in this pass — it's heavy and risky. The emergency surface is the `cycle_delivery` health
check flipping to **fail**, which rolls into the existing "Verified" header badge and Trust
card. Wire a dedicated email/incident later if the pilot wants push notification.
