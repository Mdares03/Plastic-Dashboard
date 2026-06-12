# Metrics Specification (R1–R8)

Every number shown anywhere in the product traces to exactly one rule below,
implemented exactly once in `lib/metrics/`. Views **import** metrics; they never
recompute them. When two data sources disagree, the discrepancy is **surfaced**
(drift check, health endpoint) — never silently resolved.

Code and tests reference rules by number (`// R2: window production`,
`describe("R5 downtime authority")`). A change to a number's meaning is a change
to this file first.

---

## R1 — Counter authority (work-order lifetime totals)

Lifetime totals for a work order are the edge-maintained counters on
`MachineWorkOrder`: `good_parts`, `scrap_parts`, `cycle_count`. These match the
Pi's home UI — the numbers the operator sees at the machine.

- No view may sum snapshots or cycles to produce a *lifetime* total.
- These counters are **not windowable**: never filter them by `updatedAt` (or
  any timestamp) to produce an in-window figure. See R2.

## R2 — Window production (in-window counts)

Production inside a time window `[start, end]` is computed from **deduplicated
`MachineCycle` delta rows** with `ts ∈ [start, end]`, plus manual scrap
(`ReasonEntry` rows of kind `scrap`) captured in the window.

- `goodDelta` / `scrapDelta` sums, deduplicated on the unique
  `(orgId, machineId, ts, cycle)` key.
- **Never** window lifetime counters by `updatedAt` (a WO touched once in the
  window would contribute its entire lifetime count).
- **Never** sum snapshot gauges (they are rates, not counts).

## R3 — Reconciliation invariant

For a **completed** work order: `MachineWorkOrder` counters (R1) must equal the
sum of its `MachineCycle` deltas (R2) over the WO's lifetime.

- Drift = `counter − Σ deltas` per WO. Computed by
  `lib/metrics/production.ts#checkCounterDrift`.
- Drift is **reported** (health endpoint, verification reports). It is never
  auto-corrected and never hidden by picking one side silently.

## R4 — Rate authority (OEE / Availability / Performance / Quality)

- **Window rates** = time-weighted average of `MachineKpiSnapshot` rows in the
  window, filtered to `trackingEnabled && productionStarted`.
  - Weight of a sample = time until the next sample, capped at
    `MAX_SAMPLE_WEIGHT_MS` (10 min) so gaps don't let one stale sample dominate.
- **"Current" tiles** = the latest production snapshot if it is fresher than
  `CURRENT_RATE_MAX_AGE_MS` (10 min); otherwise `null` (renders "—", see R7).
- Plain (unweighted) averages of snapshots are forbidden everywhere.

## R5 — Downtime authority

`ReasonEntry` (kind `downtime`) is the **only** source for downtime durations.
`MachineEvent` is used for live state and alerting only — never summed into
downtime KPIs. The old `max(eventSum, reasonSum)` rule is abolished.

- One entry per downtime episode (edge `incidentKey` enforces this upstream).
- An episode's contribution to a window is **clamped to the overlap** with that
  window.
- Open (unresolved) episodes are capped at `MAX_OPEN_EPISODE_MS` (12 h) — the
  generalization of the stuck-mold-change fix.
- Planned vs unplanned split is decided by `reasonCode` against the reason
  catalog, in one place.
- **Financial downtime cost (`lib/financial/impact.ts`) sources the same
  `ReasonEntry` rows + `episodeWindowMinutes`** (#13, resolved Phase 7). So
  downtime cost = (dashboard downtime minutes × idle rate) by construction;
  planned (mold-change) downtime is excluded from cost as a non-reducible loss.
  Micro vs macro is a cosmetic split by episode duration
  (`MICROSTOP_MAX_SECONDS`), not a separate authority. `MachineEvent` still
  sources performance loss (slow-cycle) and quality loss (scrap) cost — those
  are not R5 downtime. Proof: `docs/verification/phase7-13-financial-rebase.md`.

## R6 — Window authority

One timezone-aware resolver produces every window:
`today`, `yesterday`, `7d`, `30d`, `shift`, `live24h`, `custom`.

- Calendar windows (`today`, `yesterday`) are midnight-to-midnight in
  `OrgSettings.timezone` — never rolling.
- Rolling windows (`7d`, `30d`, `live24h`) end at "now".
- Every API response echoes the resolved window:
  `{ start, end, mode, timezone, label }` so any screen can prove which window
  it rendered. UI labels must match the mode (a rolling window may not be
  labeled "Hoy"/"Ayer").

## R7 — Null semantics

Missing data is `null` (rendered "—"), **never** `0` and never `100`.

- A trend bucket with no qualifying samples is a `null` bucket, not a zero
  (zeros poison averages and fake collapses).
- A "current" value older than its freshness threshold is `null` (R4).
- `0` is reserved for "measured and truly zero".

## R8 — Machine state

One precedence ladder decides the displayed machine state:

`offline > mold-change > startup-wait > stopped > microstop > running > idle`

evaluated with the existing freshness constants (heartbeat staleness defines
`offline`). Implemented once in `lib/metrics/machineState.ts`; no view or route
maintains its own copy.

---

## Constants

Centralized in `lib/metrics/spec.ts`:

| Constant | Value | Used by |
|---|---|---|
| `MAX_SAMPLE_WEIGHT_MS` | 10 min | R4 time-weighting cap |
| `CURRENT_RATE_MAX_AGE_MS` | 10 min | R4 current-tile freshness |
| `MAX_OPEN_EPISODE_MS` | 12 h | R5 open-episode cap |
| heartbeat / snapshot freshness | existing values | R8 ladder |

## Enforcement

- `tests/metrics/` asserts hand-computed golden numbers per rule against a
  seeded scenario (the definition of done for any metrics change).
- `checkCounterDrift` + downtime sanity checks run in the admin health endpoint
  (Phase 7) and in verification reports.
- Phase 3 migrates every call site to `lib/metrics/`; a view computing its own
  aggregation is a regression by definition.
