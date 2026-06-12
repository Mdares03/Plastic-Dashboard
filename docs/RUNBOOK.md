# Runbook

> Operational procedures for the MIS Control Tower. Started in Phase 0 of
> [OVERHAUL_PLAN.md](./OVERHAUL_PLAN.md); sections are added as each phase lands.

## Pending prod actions (require explicit go — system paused)

| # | Action | Script / command | Status |
|---|--------|------------------|--------|
| 1 | Revoke leaked session (was `cookies.txt`) | `node scripts/security/revoke-leaked-session.mjs --apply` | dry-run ready |
| 2 | Rotate `Machine.apiKey` (keys appear in committed flow exports) + update Pi `current_config` | `node scripts/security/rotate-machine-apikey.mjs --apply` | dry-run ready |
| 3 | Baseline KPI capture (read-only) | `npm run baseline:capture` | ✅ run 2026-06-11 → `docs/verification/baseline-2026-06-11.json` |
| 4 | R3 counter-drift check (read-only) | `npx dotenv -e .env -- tsx scripts/metrics/drift-check.ts` | ✅ run 2026-06-11 → `docs/verification/drift-2026-06-11.json` (0 completed WOs; see note) |
| 5 | Phase 2 data cleanup (stale downtime episodes, stuck mold events) | `scripts/cleanup/0{1,2}-*.mjs --apply` | dry-run ready, backup taken, **awaiting go** |

Run all `--apply` actions only after a fresh `pg_dump` backup.

> **Drift-check note (2026-06-11):** R3 reconciles only **COMPLETED** work orders.
> This DB has 30 PENDING + 9 RUNNING work orders and **zero COMPLETED**, so the
> drift exhibit is legitimately empty — work orders never transition to COMPLETED
> in the current edge flow. Flag for the trust report; re-run after the edge
> closes work orders (Phase 6).

## Phase 2 — prod data hygiene

Dry-run-by-default cleanup scripts (`scripts/cleanup/`). Pattern follows
`scripts/db-dry-run-cutoff.mjs`: no flag = report only, `--apply` = write.

| Script | Fixes | Dry-run finding (2026-06-11) |
|--------|-------|------------------------------|
| `01-stale-downtime-episodes.mjs` | Clamp `ReasonEntry.durationSeconds` > 12 h to the R5 cap; report genuine overlap duplicates | 2 runaway episodes (67.6 h, 27.5 h); **0** real duplicates |
| `02-stuck-mold-events.mjs` | Synthesize the missing `resolved` MachineEvent for stuck `active` mold-change incidents | 7 stuck incidents (all >150 h old, machine `6861…`) |
| `03-sanity-check.mjs` | Read-only guard rails (A–D); non-zero exit on failure | Pre-cleanup: A & D fail (expected); B & C pass |

**Procedure:**

```bash
# 1. fresh backup of the two affected tables
pg_dump -U mdares -d control_tower_db -t '"ReasonEntry"' -t '"MachineEvent"' \
  -Fc -f backups/phase2-pre-cleanup-$(date +%Y%m%d-%H%M%S).dump

# 2. review dry-runs
node scripts/cleanup/01-stale-downtime-episodes.mjs
node scripts/cleanup/02-stuck-mold-events.mjs
node scripts/cleanup/03-sanity-check.mjs        # expect A & D to fail pre-cleanup

# 3. apply
node scripts/cleanup/01-stale-downtime-episodes.mjs --apply
node scripts/cleanup/02-stuck-mold-events.mjs --apply

# 4. verify + re-capture the "after" exhibits
node scripts/cleanup/03-sanity-check.mjs        # must exit 0 (allPass:true)
npm run baseline:capture                        # "after-cleanup" snapshot
```

**Rollback:** restore the affected tables from the dump:
`pg_restore -U mdares -d control_tower_db --clean -t '"ReasonEntry"' -t '"MachineEvent"' <dump>`.

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

## Security operations (Phase 5)

- **Rate limits** (`lib/rateLimit.ts`, in-process): auth 10/min/IP (login, signup, verify-email),
  pair 5/min/IP, ingest 600/min/machine. Over-limit → `429` + `Retry-After`. State is per-process
  (single-instance assumption — see `SECURITY.md`); a restart resets every window.
- **Revoke a session immediately:** logout already calls `invalidateSessionCache(id)`. For a forced
  revocation, set `Session.revokedAt` in the DB; it takes effect within the 10s cache TTL (or call
  `invalidateSessionCache()` with no arg in-process to clear all).
- **Pairing codes** are 8 chars; failed/invalid attempts are logged (`pair.failed` / `pair.invalid_code`).
- Leaked-secret response: `scripts/security/revoke-leaked-session.mjs`, `rotate-machine-apikey.mjs`.

## Consistency health & accuracy (Phase 7)

- **Live consistency check (admin):** `GET /api/health/consistency` — downtime cap, downtime-within-
  capacity, completed-WO counter drift, stuck-mold. Also surfaced as the "System health" card in
  Settings. A `fail` means a number is off; investigate before trusting reports.
- **Financial ↔ dashboard congruence (#13):**
  `npx dotenv -e .env -- tsx scripts/metrics/financial-rebase-check.ts <orgId> 30` → must print
  **Congruent ✅** (financial downtime cost-minutes == `computeDowntime.unplannedMin`, Δ=0).
- **Edge-vs-dashboard accuracy report:**
  `node scripts/verify-edge-vs-dashboard.mjs [--orgId <id>]` → `docs/verification/ACCURACY_REPORT_<date>.md`.
  Re-run after every edge deploy; the good-parts exact-match % is the headline trust metric.
- **Counter drift (R3, all orgs):** `npm run drift:check`.

> Note: the active BEMIS pilot data is under org `6d2abda2-…` (slug `bemis-2`), not `7eae9e2d-…`
> (slug `bemis`, which has no downtime rows). Use the right orgId when running the exhibits.

## Edge deploy

_To be written in Phase 6: import procedure for `edge/flows.json`, `settings.js`
file-context change, bench-test ritual (reboot mid-stop, clock skew, outbox crash),
rollback via `edge/archive/`._
