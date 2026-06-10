# Runbook

> Operational procedures for the MIS Control Tower. Started in Phase 0 of
> [OVERHAUL_PLAN.md](./OVERHAUL_PLAN.md); sections are added as each phase lands.

## Pending prod actions (require explicit go — system paused)

| # | Action | Script / command | Status |
|---|--------|------------------|--------|
| 1 | Revoke leaked session (was `cookies.txt`) | `node scripts/security/revoke-leaked-session.mjs --apply` | dry-run ready |
| 2 | Rotate `Machine.apiKey` (keys appear in committed flow exports) + update Pi `current_config` | `node scripts/security/rotate-machine-apikey.mjs --apply` | dry-run ready |
| 3 | Baseline KPI capture (read-only, pulls live business data) | `npm run baseline:capture` | script ready, awaiting go |
| 4 | Phase 2 data cleanup (stale downtime episodes, stuck mold events) | `scripts/cleanup/*` | not yet written |

Run all `--apply` actions only after a fresh `pg_dump` backup.

## Environment topology (verified 2026-06-10)

- **The live production Postgres is local to this server** (`127.0.0.1:5432/control_tower_db`,
  per `.env`): it received a machine heartbeat today. `51.222.200.172`
  (`.env.backup_prod_pointing`) refuses connections — treat that env file as a
  stale pointer to a previous server.
- `control_tower_db_sandbox` (`.env.sandbox`) is the local sandbox DB; tests use a
  disposable schema there, never `control_tower_db`.

## Prod migration status

`npx prisma migrate status` (2026-06-10, against `control_tower_db`):
**24 migrations found, database schema is up to date.** In particular,
`20260424143000_add_machine_work_order_counters` IS deployed — the
"unconfirmed deployment" risk from the post-mortem audit is closed.

## Backup before mutations

```bash
pg_dump "$PROD_DATABASE_URL" -Fc -f backups/control_tower_$(date +%Y%m%d_%H%M).dump
```

## Edge deploy

_To be written in Phase 6: import procedure for `edge/flows.json`, `settings.js`
file-context change, bench-test ritual (reboot mid-stop, clock skew, outbox crash),
rollback via `edge/archive/`._
