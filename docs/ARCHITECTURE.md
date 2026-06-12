# Architecture

## System overview

- **Edge:** Raspberry Pi + Node-RED ([`edge/flows.json`](../edge/flows.json), the canonical flow artifact). Reads the machine's GPIO cycle signal, detects cycles/stops, computes OEE locally, queues messages to a MariaDB outbox with retry/backoff, POSTs to the dashboard ingest API. Older flow exports live in `edge/archive/` for reference only.
- **Dashboard:** Next.js 16 + Prisma + PostgreSQL. Ingest endpoints under `app/api/ingest/`, ~50 API routes, 8 views, email alerts (`lib/alerts/`).
- **Metrics authority:** all KPI computation lives in `lib/metrics/`, governed by [METRICS_SPEC.md](./METRICS_SPEC.md) rules R1–R8. Views import metrics; they never recompute them.

## Data flow

GPIO pulse → Node-RED cycle/stop detection → MariaDB outbox (seq-numbered, idempotent) → HTTP POST `/api/ingest/*` → Postgres (`MachineCycle`, `MachineEvent`, `MachineKpiSnapshot`, `MachineHeartbeat`, `ReasonEntry`) → `lib/metrics/` → views/reports/alerts.

## Core models (Postgres / Prisma)

- **Ingest (edge → dashboard):** `MachineCycle` (per-cycle good/scrap deltas, R2 basis; unique on
  `(orgId,machineId,ts,cycleCount)` so sums are deduped), `MachineEvent` (live state + alerting only,
  never summed into downtime — R5), `MachineKpiSnapshot` (OEE/A/P/Q gauges, time-weighted in R4),
  `MachineHeartbeat`, `ReasonEntry` (kind `downtime`/`scrap` — the **only** downtime/scrap authority).
- **Work orders:** `MachineWorkOrder` holds the edge lifetime counters `good_parts/scrap_parts/
  cycle_count` (R1 — matches the Pi's own screen). R3 invariant: these equal the WO's cycle-delta sums
  (checked by `scripts/verify-edge-vs-dashboard.mjs` + `/api/health/consistency`).
- **Alerts:** `AlertIncident` (`@@unique[orgId,machineId,incidentKey]`; firstSeen/lastSeen/notifyCount/
  suppressedCount) + `AlertNotification` (`incidentKey`, status `sent|suppressed|failed`). See alert
  pipeline below.
- **Financial:** `OrgFinancialProfile` (cost rates + formulas) with `LocationFinancialOverride`,
  `MachineFinancialOverride`, `ProductCostOverride`. Downtime cost re-uses `ReasonEntry` (#13, R5).
- **Auth/org:** `Org`, `User`, `OrgUser` (role OWNER/ADMIN/MEMBER), `Session`, `OrgInvite`, `Machine`
  (`apiKey`, pairing fields).

## Metrics authority (R1–R8)
`lib/metrics/` implements [METRICS_SPEC.md](./METRICS_SPEC.md) once, as pure functions over row shapes
(so the golden tests need no DB): `window.ts` (R6 tz windows), `rates.ts` (R4 time-weighted OEE +
R7 null gaps), `production.ts` (R1–R3 counters, `checkCounterDrift`), `downtime.ts` (R5 ReasonEntry
+ `episodeWindowMinutes`), `machineState.ts` (R8 state ladder), `events.ts` (shared parsers). Every
view/report/alert/financial path **imports** these; none recomputes them.

## Alert pipeline
`/api/ingest/event` → `lib/alerts/engine.ts`: upsert `AlertIncident` keyed on the edge's `incidentKey`
→ **gate 1** per-incident dedup (one active + one resolved per recipient/channel; active repeats only
after `repeatMinutes`) → **gate 2** circuit breaker (`lib/alerts/throttle.ts`, pure + golden-tested:
per-org cap checked first, then per-contact/hour) → send via `lib/email.ts` (3-attempt retry on
transient SMTP) or record `suppressed`. Policy + caps in `lib/alerts/policy.ts`.

## Data flow

GPIO pulse → Node-RED cycle/stop detection → MariaDB outbox (seq-numbered, idempotent) → HTTP POST
`/api/ingest/*` (rate-limited, per-machine) → Postgres → `lib/metrics/` → views / reports / alerts /
financial. The edge contract (schema versions, `incidentKey` semantics) is preserved at
`docs/archive/data_validation_edge_contract.md`.

## Deploy topology
Single Next.js instance (rate-limit state is per-process — see `SECURITY.md`) + local Postgres on the
same host (`127.0.0.1:5432`); nginx in front; the Pi runs Node-RED and POSTs over the plant network.
See `RUNBOOK.md` for environment specifics and the edge-deploy procedure (Phase 6).
