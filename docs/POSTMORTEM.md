# Post-Mortem: How the Bemis Pilot Lost Trust — and How the Rebuild Wins It Back

> Companion to the Reliability Overhaul plan. This is the *why it happened* document;
> the plan is the *what we do about it* document.

---

## 1. The timeline, as told by the repo itself

| Date | Evidence | What it means |
|---|---|---|
| 2025-12-15 | `Initial commit from Create Next App` | Project starts. |
| 2025-12-17 | `cookies.txt` (a real session cookie) committed in "Full project added" | Secrets hygiene was never established — **day 3**. |
| 2025-12 (commit #5) | Commit message: **"Issues with data flow & consistency"** | The KPI-incongruence root cause was *visible in week one*. It was patched, not architected away — and it became the #1 trust-killer six months later. |
| 2026-01 | `app/api/login copy/`, `nousar_middleware.ts` ("Before 404 fix nginx api route issue") | Debug-by-duplication: copies of routes/middleware left in the tree instead of branches. |
| 2026-04-22 | `security_risks.md` committed in a commit literally named **"pre-bemis"** | The team *knew* about the reminders auth-fallback, cross-org query, missing rate limits — **before going on-site** — and went live anyway. That exact bug then emailed the CEO for 3 days. |
| 2026-04-23 → 06-04 | `flows (61) (1).json` … `flows (68) (1).json` (6 versions, browser-download names with ` (1)` duplicates) | Edge code managed by export → download → commit. No canonical artifact, no diffability, no review. |
| 2026-04-24 → 04-30 | `fix.md`, `fix2.md` … `fix5.md`, `Reliability.md` ("reliability semi-fix") | The pilot is on fire. Fixes are being *designed as markdown handoffs* during production weeks — and most were never verified as deployed. |
| 2026-04-26 | Junk files `426`, `476`, `next` committed in "updates" | Shell-redirect accidents committed blind (`git add -A` under pressure). |
| Apr–Jun | Commits: `changes`, `changes`, `recent changes`, `Backup`, `almost_done`, `almost final` | Version control as a dump truck. 31 `.bak` files committed. Nobody could say what changed when, or roll anything back. |
| 2026-06-10 | Final commit: **"recent bemis denial"** | The repo's own epitaph for the pilot. |

44 commits, ~6 months, **zero tests, zero CI** (the only script besides build is `eslint`).

---

## 2. The five wrong turns

### Wrong turn #1 — Every view computed its own truth
**What happened:** Each feature (overview, recap, reports, financial, machine detail) was built as its own vertical slice, each re-implementing aggregation: recap time-weights snapshots, reports plain-averages them, overview takes the raw latest row, reports windows *lifetime* counters by `updatedAt`, recap takes `max(eventSum, reasonSum)` when two sources disagree.

**Why it happened:** Speed-first feature development with no metrics specification. When two sources disagreed, the code *picked one silently* (`max()`) instead of surfacing the discrepancy — which means the system was designed to *hide* incongruence until a human compared two screens.

**Trust cost:** This is the single biggest one. A plant manager who sees 353 parts on one screen and 185 on another doesn't think "aggregation bug" — they think *"this product lies."* Every other failure was forgivable; this one wasn't.

### Wrong turn #2 — Shipping known risks to a flagship client
**What happened:** `security_risks.md` enumerated the reminders auth-fallback and missing rate limits *before* the on-site rollout ("pre-bemis"). The CEO spam incident was that exact documented bug, fired in production.

**Why it happened:** No go-live gate. Risk documents were written (good instinct!) but nothing forced them to be *resolved or accepted* before deploy. A document without a gate is a confession, not a control.

**Trust cost:** Spamming the decision-maker's inbox for 3 days converted the most important stakeholder from sponsor to skeptic — during the exact window when first impressions were forming.

### Wrong turn #3 — Fix-by-document instead of fix-by-verified-deploy
**What happened:** ~20 markdown handoffs (`fix.md`…`fix6.md`, `feedback_fixes*`, `HANDOFF_*`, `Reliability.md`) describe fixes in detail. Audit result: roughly half were never confirmed deployed; some were half-applied (the OEE-trend fix filters snapshots but still emits 0 instead of null). The migration adding WO counters exists in the repo, deployment to prod unconfirmed.

**Why it happened:** Firefighting during the pilot with no environments, no tests, no deployment checklist. Writing the fix down felt like progress; nothing closed the loop to "verified in production."

**Trust cost:** The client reported the same symptoms repeatedly after being told they were fixed. "Fixed" stopped meaning anything — which is precisely the moment "20% downtime reduction" stopped being believable.

### Wrong turn #4 — The edge was a black box, not a codebase
**What happened:** Node-RED flows lived as browser-download exports (`flows (68) (1).json`), six versions committed side by side. State in memory only (lost on every reboot — losing stop episodes mid-incident), outbox seq+INSERT non-transactional, no clock-sync check, plaintext API key — and no way to diff or review any of it.

**Why it happened:** Node-RED's editor makes it easy to never treat the flow as code. No canonical artifact, no deploy procedure, no bench-test ritual.

**Trust cost:** Power blips silently corrupted downtime tracking. The numbers shifted for reasons nobody could explain — "the data is sometimes wrong and we don't know why" is the worst possible sentence in a sales conversation.

### Wrong turn #5 — Version control as a backup drive
**What happened:** `Backup` commits, `changes` ×5, 31 committed `.bak` files, duplicated routes, accidental shell-output files, committed cookies. Editing happened live on the server (the `.bak.task1/.task2/.step5` suffixes are the tell: sequential in-place edits with copy-backups, then `git add -A`).

**Why it happened:** One person moving fast with the repo as a safety net rather than a history. No branches, no PRs, no review, no `.gitignore` discipline.

**Trust cost:** Indirect but real — this is *why* nothing could be rolled back when the site broke, *why* nobody knew which fix was live, and *why* the team couldn't answer "what changed?" with confidence in front of the client.

---

## 3. The pattern underneath all five

Every wrong turn is the same trade: **velocity now, paid for with verifiability later.**
None of these were incompetence — the architecture is genuinely good (idempotent seq numbers, outbox with retry/backoff/watchdog, schema-versioned contracts, a written edge contract, risk docs). The failure was that nothing *enforced* the good intentions: no spec for metrics, no gate for risks, no test for fixes, no diff for the edge, no hygiene for the repo.

A client doesn't experience your architecture. They experience: **do the numbers match, did the thing it promised happen, and can you explain what changed.** All three require enforcement mechanisms, not skill.

---

## 4. The operating rules for the clean build

These are the non-negotiables that make "it won't happen again" a property of the system rather than a promise:

1. **One metrics spec, one module.** Every number on every screen traces to a numbered rule (R1–R8) in `METRICS_SPEC.md`, implemented once in `lib/metrics/`. A view that needs a KPI *imports* it; it never recomputes it. Disagreement between sources is *surfaced* (drift check, health endpoint) — never silently resolved.
2. **Fail closed, cap everything.** Missing secret → 503, not "fall back to any session." Alerts are keyed per incident with hard hourly caps per contact and per org. The CEO-spam scenario is a replayed automated test that must pass forever.
3. **"Fixed" means verified.** A fix exists when: code merged + test asserting the behavior + confirmed against prod (migration status, before/after capture). Markdown describes done work; it never substitutes for it. The vitest consistency suite is the definition of done for every metrics change.
4. **The edge is code.** One canonical `edge/flows.json` in the repo, every change a reviewed diff, deploy procedure + rollback in the RUNBOOK, bench-test ritual (reboot mid-stop, clock skew, outbox crash) before any Pi deploy. State persisted to file context — a power cut must not change a number.
5. **Go-live gate.** A written checklist (`GO_LIVE_CHECKLIST.md`) that must be green before anything touches the client: 72h heartbeat soak, every induced stop → exactly one alert + one ReasonEntry, security checks, rate limits, baseline capture. Known risks are either fixed or explicitly accepted in writing — never silently shipped.
6. **Repo hygiene as a habit.** Branches + meaningful commit messages, no `.bak` files (git *is* the backup), `.gitignore` covers secrets/artifacts, no `git add -A` of a live server. The repo must always be able to answer "what is deployed, and what changed since last week?"
7. **Show, don't reassure.** The client-facing trust artifacts (TRUST_REPORT, accuracy report comparing Pi counters to dashboard counters, ROI model computed from the *same* `getDowntime` number the dashboard shows) replace "trust us" with evidence. The system proves its own congruence on an admin health page, continuously.

---

## 5. Why this story actually helps the sale

The honest pitch to the decision-maker is stronger than pretending the pilot went fine:

> "The pilot's problems all had one root cause: the same metric was computed in several places, and nothing enforced agreement. We rebuilt the system around a single metrics authority, capped and audited every alert, and — most importantly — the system now *proves* its own accuracy: here is the report comparing the machine's own counters to what the dashboard shows, here is the alert-volume guarantee, and here is your downtime baseline computed from cleaned data, which is the exact number we'll measure the 20% reduction against."

The pilot's failures, named and structurally fixed, become the credibility. What was missing was never the product — it was the proof.
