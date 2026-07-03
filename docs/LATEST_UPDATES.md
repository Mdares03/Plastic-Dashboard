# Latest Updates

Running log of recent product upgrades, newest first. For the deep reliability
overhaul (Phases 0–7) see `fable_fix.md` and `docs/TRUST_REPORT.md`; this file
captures what shipped on top of that.

---

## 2026-07-03 — Pair-later for machines + illustrative "Ahorros por causa"

Branch: `reliability-overhaul`. Two demo-feedback features on top of the merged
reliability review (`ee905f6`). Verification: `tsc --noEmit` clean · `vitest` 146/146 ·
`npm run build` green · eslint clean on changed files (pre-existing errors in
`DowntimePageClient` untouched).

**Pair edge readers whenever they're ready (Task A).** Before, a machine's 24h
pairing code was never shown by the wizard and could only be minted at creation, so
codes silently expired and the machine could never be paired.
- New `POST /api/machines/[machineId]/pairing-code` (OWNER/ADMIN) re-issues a fresh
  code for a not-yet-paired machine without touching `apiKey`/`pairingCodeUsedAt`;
  writes a `SettingsAudit` (`pairing-code:regenerate`). Already-paired machines are
  not re-issued a code (the edge pair route only accepts unused codes).
- `freshPairingCode` extracted to `lib/pairingCode.ts` (shared by provisioning + the
  route); unit-tested (collision retry + long-code fallback).
- `GET /api/machines` + the machines page now expose `pairingCodeUsedAt`/`ExpiresAt`
  (and the code itself only for OWNER/ADMIN). `MachinesClient` shows a status pill
  (*Emparejada* / *Código activo* + remaining time / *Sin emparejar*) and a "Generar
  código" button that reuses the existing pairing reveal panel.
- Onboarding wizard's review step now lists each newly-created machine's code + expiry
  with copy buttons and a "pair later from Máquinas" escape hatch.

**"Ahorros por causa" shows under placeholder rates (Task B).** The Downtime page
now renders the money story whenever `costPerMin > 0` (placeholder or not), matching
the ROI page. Under the 1/min stub it shows the numbers with an amber "illustrative
rates" banner above the table (and a neutral-toned total chip); the note disappears
by itself once real rates are entered. Per-reason money math extracted to
`lib/analytics/savingsByReason.ts` (unit-tested; rows sum to the Est. cost KPI by
construction — R5/#13 congruence).

---

## 2026-06-22 — Trust signals + Downtime revamp

Branch: `reliability-overhaul`. Two workstreams landed: a **Downtime page revamp +
Action Items tracker**, and a **client-facing trust / perceived-reliability roadmap**
that surfaces the (already-built but invisible) reliability proof to the decision-maker.

Verification for both: `tsc --noEmit` clean · `vitest` 80/80 · i18n EN↔ES parity 0 missing ·
eslint clean on changed files (pre-existing `no-explicit-any` / unused-`ApiEnvelope`
warnings excepted).

---

### 1. Downtime revamp + Action Items (plan: `downtime_revamp.md`)

Split the cluttered ~2,600-line `/downtime` page into a calm analysis page plus a
dedicated task tracker.

**New — Action Items kanban (`/action-items`)**
- `app/(app)/action-items/{page,layout}.tsx` — owner/member page, gated under
  `screenlessMode` like `/downtime`.
- `components/actionItems/ActionItemsClient.tsx` + `ActionCard.tsx` — board with four
  columns (Open / In progress / Blocked / Done), summary tiles (Open · Due soon · Overdue),
  filters (Owner · Machine · Priority · **Mine**), and `+ New action`.
- **Drag-and-drop** via `@dnd-kit/core` (added dependency) with ◀/▶ move buttons kept as an
  accessible fallback; status persists through `PATCH /api/downtime/actions/[id]`.
- Cards deep-link back to `/downtime?machineId=…&reasonCode=…`.

**Changed — Downtime analysis page**
- Decluttered header: range (Today/7D/30D), a promoted **Show: All / Classified only** toggle
  with the classification rate inline, and a **More filters** popover (machine, shift, planned,
  microstop, minutes/count) with removable chips. Removed dead "Plant select", the ad-hoc
  MXN/min input, and Share.
- KPI strip cut from 8 → **5 tiles** (Total downtime · Stops · Top reason · Classified % ·
  Est. cost), using the shared `KpiTile` with plain-language captions. Est. cost now sources the
  configured financial rate via a new member-accessible `GET /api/downtime/cost-rate`
  (reuses `resolveCostPerMin`, extracted to `lib/financial/costPerMin.ts`); unset → "—" + a
  "Set cost rates" link. Cut the indefensible MTBF / MTTR / Availability-loss proxies.
- Body **view switch (Overview · Events)**; the day×hour **heatmap was kept at the bottom of
  Overview** (visible, out of the way) after feedback; drilldown table folded behind an expander.
- Extracted `components/downtime/ActionModal.tsx` + `lib/downtime/actions.ts` (types, pills,
  fetch helpers) shared by both pages; trimmed dev-placeholder copy; pruned ~46 dead i18n keys.

**Sidebar / i18n**
- New nav entry **Action Items** (`ClipboardList`) after Downtime, gated with `screenlessMode`.
- New keys `nav.actionItems`, `actionItems.*`, `downtime.view.*`, `downtime.classToggle.*`,
  etc., in EN + ES.

---

### 2. Client trust / perceived-reliability roadmap (plan: `reactive-wondering-harp`)

The reliability *work* was already done (one metric authority, alert throttling, security);
this makes it **visible to the CEO from day 1**. Four independently-shippable phases.

**Phase 1 — Visible congruence**
- `lib/health/checks.ts` — extracted the consistency + metric-consistency check logic out of the
  routes so it backs the endpoints, the header badge, and the Trust page (one source).
- `GET /api/health/summary` — cheap, `unstable_cache`-d (5 min) rollup for the badge.
- `components/health/VerifiedBadge.tsx` — persistent **"Verified ✓ / Review / Drift"** pill in
  the app header (`AppShell`), links to `/trust`.
- `/trust` page (`components/trust/TrustClient.tsx`, owner-only nav) — live hero status, the
  shared `HealthChecks` cards, and plain-language guarantees. Settings → Integrity now reuses the
  same `components/health/HealthChecks.tsx` (no divergence).

**Phase 2 — Always-on freshness**
- `GET /api/status` — member-accessible fleet-freshness rollup.
- `components/health/FreshnessPill.tsx` — header pill: green ≤5 min · amber 5–10 min or
  data-loss · red >10 min. Closes the silent-staleness gap; distinguishes data-loss from stopped.

**Phase 3 — Alert-trust proof**
- `getAlertThrottleStats()` + a **"Smart throttling is on"** banner on `/alerts` showing
  sent vs **suppressed duplicates** (last 30d).
- Owner **"Send me a test alert"** button → `POST /api/alerts/test` (`buildTestAlertEmail`).

**Phase 4 — Day-1 emailed artifacts**
- Weekly production summary auto-email: `buildWeeklyReportEmail` + cron route
  `POST /api/reports/weekly/email` (secret-gated, fans out to active alert contacts).
- One-time **"reliability restored"** assurance email: `buildAssuranceEmail` + owner button on
  `/trust` → `POST /api/trust/assurance-email`.
- Weekly report print/PDF already existed (`/reports/weekly?print=1`) — reused, no new route.

**Config / ops**
- New env vars: `WEEKLY_REPORT_EMAIL_SECRET` (weekly summary cron). Existing:
  `ROI_SUMMARY_EMAIL_SECRET`, `DOWNTIME_ACTION_REMINDER_SECRET`.
- `docs/RUNBOOK.md` → new **"Scheduled emails"** section (routes, secrets, cron cadence).
- i18n: `nav.trust`, `trust.*`, `status.*`, `alerts.trust.*` added in EN + ES.

---

### Follow-ups / not yet done
- **Live/browser verification pending** — a stale long-running `next dev` held the dev lock,
  so runtime smoke was inconclusive. Restart dev and check: header badge + freshness pill,
  `/trust`, the Alerts banner + test button, and `curl -X POST '/api/reports/weekly/email?token=…&orgId=…'`.
- **Not committed yet** — all of the above is in the working tree on `reliability-overhaul`.
- Schedule the weekly-summary cron once `WEEKLY_REPORT_EMAIL_SECRET` is set in prod.
- Edge reliability (Phase 6 of `fable_fix.md`) remains the only outstanding overhaul phase
  (Pi-gated).
