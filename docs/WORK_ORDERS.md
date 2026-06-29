# Work Orders — completion & data-integrity page

**Route:** `/work-orders` · **Audience:** any signed-in org member (acknowledge actions are admin-only)

This page answers one question for every job a machine runs: **can I trust these
numbers?** It does that by checking each work order two independent ways — *did the
machine count correctly*, and *did all of its data reach the cloud* — and tolerating
the things that aren't actually problems (like scrap). It replaced an older single
"Mismatch ✗" badge that lumped real errors, harmless scrap, and lost-in-transit data
into one permanent red flag with no way to clear it.

---

## 1. What you see

A table, one row per work order, newest/most-urgent first. Columns:

| Column | Meaning |
|---|---|
| **Job** | Work-order ID, with SKU · mold underneath |
| **Machine** | Which machine ran it |
| **Status** | Active (still running) or Finished |
| **Cavities** | Active cavities in the mold (parts produced per cycle) |
| **Cycles received** | How many individual cycle records reached the cloud for this job |
| **Parts made** | Good + scrap parts the job's counter reported |
| **Status** (pill) | The verdict — see §4 |

Click any row to expand it into two plain-language panels: **"Did the machine count
correctly?"** and **"Did all the cycle data reach the cloud?"**

A summary line at the top reads either *"All N jobs check out"* or *"M of N jobs need a
look"* — where "need a look" counts only genuine problems (counter errors and
unexplained gaps), never scrap or explained gaps.

---

## 2. Where the numbers come from

Every number on this page is computed by one shared function,
`getWorkOrderReconciliation()` in **`lib/workOrders/reconciliation.ts`**, which the page
loads through `GET /api/work-orders/completion`. The same function backs the health
checks, so the Work Orders tab and the reliability/Trust card can never disagree.

It reads four sources:

| Source | Table | What it provides |
|---|---|---|
| **The work order's own counters** | `machine_work_orders` | `good_parts`, `scrap_parts`, `cycle_count`, `cavities_active/total` — the machine's authoritative running totals, delivered to the cloud inside **KPI snapshots** |
| **Delivered cycle records** | `MachineCycle` | one row per cycle that actually reached the cloud (counted + summed), delivered through the **cycle outbox** stream |
| **Sensor-outage history** | `MachineHeartbeat` | heartbeats with `reader_online = false` — windows where the machine's sensor was offline (DATA_LOSS) |
| **Acknowledgements** | `work_order_gap_acks` | gaps a human (or the one-time bulk-accept) has reviewed and accepted |

### Why the two paths matter (the root of every "gap")

The job's counter and the per-cycle records travel to the cloud on **two different
roads**:

- **Counter (`good_parts`, `cycle_count`)** rides inside the periodic **KPI snapshot** —
  a cumulative value re-sent every heartbeat. Resilient: if one is lost, the next
  re-sends the running total, so it stays whole.
- **Cycle records (`MachineCycle` rows)** ride the **cycle outbox** — one message per
  cycle. If a message is dropped (a sensor outage, or the June 15–18 outbox-freeze bug),
  that individual record is gone; nothing re-sends it.

So when more cycles ran than records arrived, the counter is *ahead* of the cycle rows.
**The parts were really made — we're just missing the per-cycle detail for that window.**
That difference is the "gap," and it is a data-completeness fact, not a wrong number.

---

## 3. The two checks

Computed by the pure, unit-tested function `deriveWorkOrderAudit()` (same file).

### Check A — Counter integrity (`countOk`)

> Did the machine's *own* counter stay internally consistent?

```
cavities × (the WO's own cycle_count)  ≈  good_parts      (scrap + 1 part of slack tolerated)
```

- Uses the WO's **own** `cycle_count`, never the delivered-row count — so a delivery gap
  can never masquerade as a counting error.
- **Skipped** (treated as OK, shown as "can't check") when cavities are unknown, or when
  `cycle_count` is missing/stale (zero, or lower than the rows already delivered, which
  means it was never propagated at close — a separate edge issue, not a mis-count).
- `countOk = false` is the **only** condition that means the machine genuinely
  mis-counted.

### Check B — Delivery completeness (`delivery`)

> Did every cycle the machine ran actually reach the cloud?

```
effectiveCycles = the WO's cycle_count when usable, else round(good_parts / cavities)
missing         = max(0, effectiveCycles − cyclesReceived)
```

If `missing > 0`, it's classified by **cause**:

| Class | When | Tone |
|---|---|---|
| `explained` | An acknowledgement exists for it, **or** the job's run overlapped a recorded sensor outage (`reader_online = false`) | amber / informational |
| `recoverable` | The job is still open and was updated in the last 2 h — backlog may still arrive | amber / informational |
| `unexplained` | A gap with no outage and no acknowledgement | **red — the real signal** |

### Scrap is always tolerated

Scrap parts are tracked separately (in `scrap_parts` / `ReasonEntry`), not as extra cycle
records, so they never create a gap or a counter error on their own. The expand panel
notes when scrap was set aside.

---

## 4. The statuses, and how to fix each

| Pill | Plain meaning | What to do |
|---|---|---|
| 🟢 **Reconciled** | Counted right, all data arrived. Fully trustworthy. | Nothing. |
| 🟡 **Data gap · N** | N cycles weren't recorded — known sensor outage, or already accepted. Parts are real; per-cycle detail for that window is missing. | Nothing. It's explained. |
| 🟡 **Catching up · N** | Open job, N records still arriving. | Wait — it self-resolves. If it lingers for hours, treat as below. |
| 🔴 **Counter error** | The machine's own numbers don't add up (likely an edited count or an unclean close). | Open the job and review the counts with that machine's operator. |
| 🔴 **Unverified gap · N** | Data missing with **no known cause**. Rare on a healthy system. | See §5. Either accept (if it's old/known) or acknowledge (if you can account for it); an unexplained new one is worth investigating. |

Rule of thumb: **Green = trust it. Yellow = informed, no action. Red = look at it.**

---

## 5. The actions

### Acknowledge a single gap
The expand panel of an **Unverified gap** row shows an **Acknowledge gap** button (admins
only). It records that the gap was reviewed and accounted for, storing the gap size at
that moment, then the row turns amber/explained.
→ `POST /api/work-orders/gap` (admin-gated; recomputes the gap server-side so the stored
size is trustworthy).

### Accept the known past outage (one-time cleanup)
The current 7 unexplained gaps are leftovers from the June 15–18 outbox freeze (now
fixed) and can't be recovered. Settings → Integrity / the Trust page surfaces a one-click
**"Accept known outage"** under the `cycle_delivery` health check. It acknowledges every
*current* unexplained gap as a known one-time loss, so the board starts clean.
→ `POST /api/health/fix/cycle-backfill` (admin-gated, **idempotent** — a second run
accepts 0, because acknowledged gaps are no longer "unexplained").

After this baseline, any **new** unexplained gap is genuinely new — which is the point.

---

## 6. How this surfaces elsewhere (the "emergency" path)

Two health checks in **`lib/health/checks.ts`** read the same reconciliation:

- **`counter_drift`** — counts finished jobs where `countOk = false` (a real mis-count).
- **`cycle_delivery`** — `fail` if any unexplained gap exists; carries the
  `cycle_backfill` one-click fix. After the baseline accept, it returns to `ok`.

`cycle_delivery` going **fail** rolls up into the header **"Verified"** badge and the
**Trust** page. So a new unexplained gap becomes visible system-wide without anyone
hunting for it — and because scrap and explained gaps can't trip it, a red here actually
means something. *(An email/push on a new gap is intentionally not wired yet — the alert
engine is event-driven and adding a new alert type safely is its own task; the red
rollup is the current emergency surface.)*

---

## 7. Files & data flow

```
app/(app)/work-orders/page.tsx
  └─ components/workOrders/WorkOrderCompletionClient.tsx     ← the table + status pills + actions
       └─ GET /api/work-orders/completion
            └─ lib/workOrders/reconciliation.ts
                 • getWorkOrderReconciliation()  ← reads the 4 sources, builds rows
                 • deriveWorkOrderAudit()        ← PURE check logic (countOk + delivery)
                 • isFlaggedRow()                ← "needs a look" predicate

Actions:
  POST /api/work-orders/gap                 → app/api/work-orders/gap/route.ts        (acknowledge one)
  POST /api/health/fix/cycle-backfill       → app/api/health/fix/cycle-backfill/route.ts (accept known outage)

Health / Trust:
  lib/health/checks.ts        → counter_drift + cycle_delivery checks
  components/health/HealthChecks.tsx → renders checks + the fix buttons

Schema:
  prisma/schema.prisma  → model WorkOrderGapAcknowledgement (table work_order_gap_acks)
  migration 20260624190539_add_work_order_gap_acks

Tests / proof:
  tests/workOrders/reconciliation.test.ts        ← golden cases for every branch
  scripts/workOrders/recon-verify.ts             ← read-only DB exhibit
  docs/verification/workorder-audit-rework.md    ← before/after on live bemis-2 data
```

---

## 8. Known limitation

Sensor-outage auto-explain uses overlap of the job's `[createdAt, updatedAt]` span with
any recorded outage heartbeat. A normal-length job gives a precise match; an abnormally
long-running job (e.g. a test WO spanning months) overlaps almost any outage and so
auto-explains broadly. Acceptable for the pilot; revisit with per-cycle-timestamp gap
localization if long jobs become common.
