# Architecture

> Stub — to be completed in Phase 7 of [OVERHAUL_PLAN.md](./OVERHAUL_PLAN.md).

## System overview

- **Edge:** Raspberry Pi + Node-RED ([`edge/flows.json`](../edge/flows.json), the canonical flow artifact). Reads the machine's GPIO cycle signal, detects cycles/stops, computes OEE locally, queues messages to a MariaDB outbox with retry/backoff, POSTs to the dashboard ingest API. Older flow exports live in `edge/archive/` for reference only.
- **Dashboard:** Next.js 16 + Prisma + PostgreSQL. Ingest endpoints under `app/api/ingest/`, ~50 API routes, 8 views, email alerts (`lib/alerts/`).
- **Metrics authority:** all KPI computation lives in `lib/metrics/`, governed by [METRICS_SPEC.md](./METRICS_SPEC.md) rules R1–R8. Views import metrics; they never recompute them.

## Data flow

GPIO pulse → Node-RED cycle/stop detection → MariaDB outbox (seq-numbered, idempotent) → HTTP POST `/api/ingest/*` → Postgres (`MachineCycle`, `MachineEvent`, `MachineKpiSnapshot`, `MachineHeartbeat`, `ReasonEntry`) → `lib/metrics/` → views/reports/alerts.

## To document (Phase 7)

- Entity-relationship sketch of the core Prisma models
- Edge contract (schema versions, incidentKey semantics) — see `docs/archive/data_validation_edge_contract.md` for the original
- Alert pipeline (engine, policy, incidents, caps)
- Deploy topology (server, nginx, Pi)
