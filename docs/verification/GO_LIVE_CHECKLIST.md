# Go-Live Checklist

> The gate the pilot never had. The pilot's known risks were documented before rollout and shipped
> anyway (`docs/archive/security_risks.md`, committed in "pre-bemis"). **Nothing touches the client
> until every box below is green or explicitly accepted in writing.** A document without a gate is a
> confession, not a control.

Sign-off: each item is checked by running the linked command/exhibit, not by assertion.

## A. Metrics congruence (the trust-killer)
- [ ] `npx vitest run` green (52+ tests) — the metrics authority + alert throttle goldens.
- [ ] `npx tsc --noEmit` clean.
- [ ] Financial downtime cost reconciles with the dashboard: `tsx scripts/metrics/financial-rebase-check.ts <orgId> 30` → **Congruent ✅ (Δ < 0.5 min)**.
- [ ] Consistency health endpoint (`GET /api/health/consistency`, admin) returns no `fail` check; `counter_drift` is `ok` or the known `warn` (0 completed WOs).
- [ ] Settings → "System health" card renders green/amber for the org.

## B. Alerts (the CEO-spam fix)
- [ ] Throttle goldens pass, incl. the 3-day same-incident replay → exactly 1 active send.
- [ ] On the bench Pi: induce one microstop → **exactly one** alert email + one `ReasonEntry`.
- [ ] Reminders endpoint returns **503** when `DOWNTIME_ACTION_REMINDER_SECRET` is unset (fail-closed), not a session fallback.
- [ ] Circuit-breaker caps confirmed: per-contact/hour and per-org/hour suppress, recorded as `suppressed` (visible in the alerts inbox).

## C. Security
- [ ] Rate limits return `429` on flood: login/signup/verify (10/min/IP), pair (5/min/IP), ingest (600/min/machine).
- [ ] `GET /api/org/members` as a non-admin returns no invite tokens (preview only) and `canManage:false`.
- [ ] Logout revokes the session within ~10s (cache TTL) and immediately in the serving process.
- [ ] Pairing codes are 8 chars; expired codes are rejected.
- [ ] `/security-review` on the release diff: no HIGH/MEDIUM open, or each accepted in `SECURITY.md`.

## D. Edge reliability (Phase 6 — bench Pi)
- [ ] Reboot mid-stop → same `incidentKey` resumes, one alert (persistent file context).
- [ ] Clock-skew test → `clock_unsynced` flagged on outbox messages, not silently mis-timed.
- [ ] Outbox crash test → no burned/skipped seq (seq + INSERT transactional).
- [ ] WOs **close** on the edge → accuracy report shows completed-WO reconciliation (today: 0 completed).
- [ ] Accuracy report (`scripts/verify-edge-vs-dashboard.mjs`) good-parts exact-match trends toward ~100% post-deploy (baseline: 55.6% exact / 80.6% within ±1%).

## E. Soak & data
- [ ] 72h continuous heartbeat with no gap (`MachineHeartbeat`).
- [ ] `pg_dump` backup taken and restorable (`docs/RUNBOOK.md`).
- [ ] Baseline captured: `npm run baseline:capture` → `docs/verification/baseline-<date>.json`.
- [ ] Real cost rates entered in `OrgFinancialProfile` (currently placeholders = 1) so `ROI_MODEL.md` money figures become real.

## F. Sign-off
- [ ] Every box above checked, or the exception listed here with owner + date + accepted-by:

| Item | Why deferred | Accepted by | Date |
|---|---|---|---|
| | | | |
