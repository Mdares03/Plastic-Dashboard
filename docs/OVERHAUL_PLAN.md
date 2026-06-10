# MIS Control Tower — End-to-End Reliability Overhaul & Client Assurance Plan

## Context

Production-monitoring system for a plastic injection company (Bemis): Raspberry Pi + Node-RED (`flows (68) (1).json`, 219 nodes) reads the machine's GPIO cycle signal, detects cycles/stops, computes OEE, queues to a MariaDB outbox with retry, and POSTs to a Next.js 16 + Prisma + PostgreSQL dashboard (52 API endpoints, 8 views, email alerts).

The pilot eroded trust: KPIs disagreed between views, the CEO was spammed with alert emails for ~3 days, parts of the site broke, and security was loose. The decision maker likes the product but is no longer certain of a positive ROI / 20% downtime reduction. **Goal: make every number congruent, alerts trustworthy, the system demonstrably reliable — and produce client-facing evidence of it.**

**Constraints/decisions (user-confirmed):** pilot is PAUSED (free to restructure, no backward-compat needed); full prod access (Postgres/server/Pi) during execution; Node-RED flow changes in scope (we edit the JSON, user redeploys); deliverables = technical overhaul + client-facing assurance/ROI package. All work on branch `claude/stoic-goldberg-ir9sc6`.

## Root causes (verified in code, not just docs)

1. **KPI incongruence — the trust-killer.** Three+ computation paths for the same metrics:
   - Recap time-weights snapshots (`lib/recap/getRecapData.ts:700-715`); Reports plain-averages them (`lib/reports/queries/oee.ts`); Overview/machine-detail use the raw latest snapshot (`lib/machines/withLatest.ts`).
   - Recap downtime takes `max(eventSum, reasonSum)` (`getRecapData.ts:758`) — hidden double authority.
   - `lib/reports/queries/production.ts:17` windows **lifetime** `MachineWorkOrder.goodParts` by `updatedAt` → any WO touched in the window contributes its full lifetime count.
   - Manual scrap lives in `ReasonEntry`/`MachineWorkOrder.scrap_parts` but not `MachineCycle.scrapDelta` → views disagree.
   - Date windows inconsistent ("Ayer" rolling vs calendar; timezone in `OrgSettings.timezone` not consistently applied); OEE trend still emits 0 for empty days (`lib/reports/queries/oeeTrend.ts` — fix4 only half-deployed).
2. **Alert spam.** `app/api/downtime/actions/reminders/route.ts:40` falls back to any session if secret unset; :62 has no orgId filter. `lib/alerts/engine.ts` has per-event dedup but no per-incident throttle, no hourly cap, no digest, no email retry. Edge now sends a unified `incidentKey` — backend ignores it.
3. **Security.** GET `/api/org/members` leaks invite tokens to any member; 5-char pairing codes return apiKey; zero rate limiting anywhere; 30s session-revocation lag; `cookies.txt` (real session cookie) committed to repo; flows JSONs contain the machine API key.
4. **Dirty prod data.** Stale/duplicate `ReasonEntry` rows inflating downtime (3M+ min); stuck mold-change events; numeric reason labels; `add_machine_work_order_counters` migration exists in repo but prod deployment unconfirmed.
5. **Edge fragility.** Flow/global context (zeroStreak, anomalyState, throttle state) lost on reboot; no clock-sync check; outbox seq+INSERT not transactional.
6. **Repo mess.** Dead routes (`app/api/login copy/`, `logout copy/`, `nousar_middleware.ts`), junk root files, 6 old flows backups, ~20 scattered fix/handoff markdowns, many `.bak` files.

## Execution plan (8 phases, ordered by trust impact)

| Phase | Theme | Size | Depends on |
|---|---|---|---|
| 0 | Repo hygiene + credential rotation + baseline capture | S | — |
| 1 | METRICS_SPEC + shared `lib/metrics/` module + test harness | L | 0 |
| 2 | Prod data hygiene (runbook + dry-run cleanup scripts) | M | 0 (parallel w/ 1) |
| 3 | Migrate all 16 call sites to `lib/metrics/` | L | 1, 2 |
| 4 | Alert trust overhaul (incidents, caps, retry, fail-closed) | M | 0 |
| 5 | Security hardening (lean, no new infra) | M | 0 |
| 6 | Edge reliability (Node-RED flow edits + deploy runbook) | M | 4 |
| 7 | Verification & client assurance package | M | 1–6 |

### Phase 0 — Repo hygiene, credentials, baseline (S)
- Delete dead/junk: `nousar_middleware.ts`, `app/api/login copy/`, `app/api/logout copy/`, root `426`, `476`, `next`, `mis-control-tower@0.1.0`, `prisma.config.ts.bak`, all `*.bak*` files.
- **`cookies.txt`: delete + gitignore + revoke that Session row in prod; rotate `Machine.apiKey` (it appears in committed flows JSONs) and update Pi `current_config`.** Git-history purge optional (private repo).
- Move 5 old `flows*.json` → `edge/archive/`; rename `flows (68) (1).json` → `edge/flows.json` (canonical edge artifact).
- Create `docs/` tree; move the ~20 fix/handoff markdowns → `docs/archive/`; stub `docs/{ARCHITECTURE,METRICS_SPEC,RUNBOOK,SECURITY}.md`.
- `scripts/capture-baseline.mjs` (read-only): snapshot current KPI outputs from prod endpoints → `docs/verification/baseline-<date>.json` (the "before" exhibit).
- `npx prisma migrate status` against prod; record in RUNBOOK.
- Verify: `npm run build` passes; no imports of deleted files.

### Phase 1 — Metrics authority spec + `lib/metrics/` (L) — THE CENTERPIECE
Write `docs/METRICS_SPEC.md` with numbered rules (referenced in code comments and tests):
- **R1 Counter authority:** WO lifetime totals = `MachineWorkOrder.good_parts/scrap_parts/cycle_count` (edge counters; matches Pi home UI).
- **R2 Window production:** in-window = deduped `MachineCycle` deltas + manual-scrap `ReasonEntry` rows. Never window lifetime counters by `updatedAt`; never sum snapshot gauges.
- **R3 Reconciliation invariant:** completed WO counters must equal cycle-delta sums; drift surfaced, never silently resolved.
- **R4 Rate authority:** window OEE/A/P/Q = time-weighted snapshot average filtered to `trackingEnabled && productionStarted`, per-sample weight capped at 10 min; "current" tiles = latest production snapshot if <10 min fresh, else `null`.
- **R5 Downtime authority:** `ReasonEntry` is the ONLY downtime source (delete the `max()` rule); one entry per episode, clamped to window overlap; open episodes capped at 12h (generalizes the mold fix); planned vs unplanned via reasonCode; `MachineEvent` only for live state + alerting.
- **R6 Window authority:** one timezone-aware resolver (`today`/`yesterday`/`7d`/`30d`/`shift`/`live24h`/`custom`); every response echoes resolved `{start, end, mode, timezone, label}`.
- **R7 Null semantics:** missing data = `null`/"—", never 0 or 100; trend gaps = null buckets.
- **R8 Machine state:** one precedence ladder (offline > mold-change > startup-wait > stopped > microstop > running > idle) with existing freshness constants.

Build `lib/metrics/` — `spec.ts` (R-rule constants), `window.ts` (extract tz helpers from `lib/recap/redesign.ts`), `production.ts` (R1–R3 incl. `checkCounterDrift`), `rates.ts` (extract `weightedAvg`, add filter+cap, `getLatestRates`, `getRateTrend` with null gaps), `downtime.ts` (extract recap reason aggregation minus `max()`), `machineState.ts` (extract ladder from `app/api/machines/[machineId]/route.ts`), `events.ts` (dedupe the 3 copies of event parsers), `types.ts`. Batched by machineIds, returns `Map<machineId, T>`, instrumented with `lib/perf/serverTiming.ts`. Caching stays at callers.

Test harness lands here: add **vitest** (only new dependency), `tests/fixtures/seedScenario.ts` seeds a known scenario into a disposable Postgres schema; `tests/metrics/` asserts hand-computed golden numbers per R-rule. Run `checkCounterDrift` read-only against prod to quantify drift (feeds Phase 2).

### Phase 2 — Prod data hygiene (M)
All scripts dry-run by default (`--apply` to execute), pattern from `scripts/db-dry-run-cutoff.mjs`; `pg_dump` backup first (documented in RUNBOOK).
- `scripts/cleanup/01-stale-downtime-episodes.mjs`: clamp >12h/open-stale episodes; detect pre-incidentKey duplicate entries (same machine, overlapping interval, same reason → keep longest).
- `scripts/cleanup/02-stuck-mold-events.mjs`: resolve stuck active mold-change incidents.
- Run existing `scripts/backfill-downtime-reasons.mjs` for numeric labels (verify mapping against `ReasonCatalogItem` first).
- Deploy pending migrations (esp. `20260424143000_add_machine_work_order_counters`).
- Re-run drift check + baseline capture ("after-cleanup" exhibit). Sanity assertion: 30d downtime < machines × window minutes.

### Phase 3 — Migrate all call sites to `lib/metrics/` (L)
16 call sites in blast-radius order (response shapes preserved; UIs untouched unless labels lie):
1. `lib/recap/getRecapData.ts` (recap grid + summary) — delete `max()` downtime
2. `lib/recap/redesign.ts` (machine detail/timeline)
3. `lib/recap/timelineApi.ts` + timeline routes
4. `lib/overview/getOverviewData.ts` / `getOverviewSummary.ts` — freshness-aware latest rates
5. `lib/machines/withLatest.ts` (absorb/thin wrapper)
6. `app/api/machines/[machineId]/route.ts` (delete local state-ladder copy)
7. `app/api/reports/route.ts` + `lib/reports/queries/oee.ts` — time-weighted, calendar windows
8. `lib/reports/queries/production.ts` — **fix lifetime-vs-window bug (R2)**
9. `lib/reports/queries/losses.ts`
10. `lib/reports/queries/oeeTrend.ts` — null gaps (completes fix4)
11. `downtimeByShift.ts`, `classificationRate.ts`, `scrapTopSkus.ts`, `cyclePerformance.ts`
12. `lib/reports/weeklyReport.ts` + weekly route
13. `lib/financial/impact.ts` + financial routes/page (calendar 7d)
14. `app/api/analytics/{pareto,coverage,downtime-events}` + `lib/analytics/downtimeRange.ts`
15. `app/api/reports/filters/route.ts`
16. `lib/alerts/getAlertsInboxData.ts` (rolling OK but labeled `live24h`)

Relabel any "Hoy/Ayer" UI backed by rolling windows. Verify per endpoint: before/after field-level diff against prod snapshot with R-rule justification for each expected change; vitest suite asserts all views return identical golden numbers.

### Phase 4 — Alert trust (M)
- New `AlertIncident` model (`@unique([orgId, machineId, incidentKey])`, firstSeen/lastSeen/status/lastNotifiedAt/notifyCount) — one migration; engine keys on edge's `incidentKey`.
- `lib/alerts/engine.ts`: one "active" + one "resolved" notification per incident per recipient/channel; `repeatMinutes` per-incident; **circuit breaker** — max emails/contact/hour (default 10) + org cap (default 60/h), suppressed sends recorded as `suppressed` rows.
- `lib/alerts/policy.ts`: zod-extend policy with `maxPerContactPerHour`, `maxPerOrgPerHour`, optional `digest`.
- `lib/email.ts`: 3-attempt retry w/ backoff for transient SMTP errors.
- Reminders route: **fail-closed** (503 if secret unset, delete session fallback), add org scoping.
- Alerts inbox surfaces sent/suppressed/failed per incident.
- Verify: vitest replay of the CEO-spam scenario (N events, same incidentKey → exactly 1 active + 1 resolved email); 50-incidents/hour cap test; bench Pi microstop → single email.

### Phase 5 — Security hardening (M, no new infra)
- `app/api/org/members/route.ts` GET: role check; never return raw invite tokens (preview only).
- `lib/rateLimit.ts`: in-process fixed-window limiter — login/signup/verify 10/min/IP, pair 5/min/IP, ingest 600/min/machine. Document single-instance limitation.
- Pairing codes 5→8 chars, enforce expiry, log failed attempts.
- `requireSession`: export `invalidateSessionCache()`, call on logout/deactivation; cache TTL 30s→10s.
- Finish with `/security-review`; fold residuals into `docs/SECURITY.md` (incl. accepted risk: plaintext api_key on Pi).
- Verify: scripted curl checks (member vs admin, 429s, revocation within 10s).

### Phase 6 — Edge reliability (Node-RED) (M)
Deliverable: edited `edge/flows.json` + RUNBOOK "Edge deploy" section (import steps, `settings.js` change, rollback = archived flow).
- Persistent file context for state-bearing vars (zeroStreak, anomalyState, KPI throttle) — survives reboot mid-incident.
- Clock-sync guard: 60s `timedatectl` check → `clockSynced` in heartbeat + `clock_unsynced` tag on outbox messages (small ingest tweak to store it).
- Transactional outbox: combine seq generation + INSERT into one transaction (no burned/skipped seqs on crash).
- Immediate settings re-fetch on deploy/restart.
- Verify on bench Pi: reboot mid-stop resumes same incidentKey with one alert; clock-skew test; 1-hour simulation comparing MariaDB counters vs Postgres sums (becomes the Phase 7 accuracy report generator).

### Phase 7 — Verification & client assurance package (M)
- Finalize vitest metrics-consistency suite (every endpoint returns identical golden numbers, R-rule annotated).
- `app/api/health/consistency/route.ts` (admin-only): live drift + downtime sanity checks; "System health" card in settings — the always-on guarantee.
- `scripts/verify-edge-vs-dashboard.mjs`: per-WO edge-vs-dashboard count comparison → markdown accuracy report (`docs/verification/ACCURACY_REPORT_TEMPLATE.md`).
- `docs/verification/GO_LIVE_CHECKLIST.md`: 72h heartbeat continuity, every induced stop → exactly one alert + one ReasonEntry, reboot recovery, rate limits.
- `docs/TRUST_REPORT.md` (client-facing, ES/EN): before/after numbers, R1–R8 in plain language, alert guarantees, evidence links.
- `docs/ROI_MODEL.md`: downtime baseline from cleaned data × `OrgFinancialProfile` cost rates → 20% reduction target math; monthly tracking uses the same `getDowntime` number the dashboard shows (congruent by construction).
- Finalize `docs/ARCHITECTURE.md` + `docs/RUNBOOK.md`.

## Reuse vs build
**Extract, don't rewrite:** `weightedAvg` (getRecapData.ts:700), tz helpers (`redesign.ts`), event parsers (3 copies → `lib/metrics/events.ts`), state ladder (machines route), `logLine`, `serverTiming`, zod schemas, `normalizeShiftOverrides`, dry-run script pattern, `AlertPolicySchema`.
**Build:** `lib/metrics/`, `lib/rateLimit.ts`, `AlertIncident` + throttling, email retry, cleanup scripts, vitest harness (only new dep), edge flow edits, docs.
**No new infra:** no Redis/queue/cron service.

## Verification (end-to-end)
1. `npm run build` + vitest green at every phase.
2. Before/after endpoint diffs against prod DB snapshot with R-rule justifications.
3. Prod cleanups: dry-run reports reviewed before `--apply`; pg_dump backup first.
4. Bench-Pi tests for edge changes (reboot/clock/outbox).
5. Final: baseline-vs-after capture + accuracy report + go-live checklist = the evidence inside TRUST_REPORT.md.

## Critical files
`lib/recap/getRecapData.ts`, `lib/recap/redesign.ts`, `lib/alerts/engine.ts`, `app/api/ingest/event/route.ts`, `lib/reports/queries/{oee,production,oeeTrend,losses}.ts`, `lib/overview/getOverviewData.ts`, `app/api/machines/[machineId]/route.ts`, `app/api/downtime/actions/reminders/route.ts`, `app/api/org/members/route.ts`, `lib/email.ts`, `prisma/schema.prisma`, `edge/flows.json` (renamed from `flows (68) (1).json`).