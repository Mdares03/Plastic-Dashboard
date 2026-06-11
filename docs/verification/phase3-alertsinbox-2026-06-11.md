# Phase 3 — alerts inbox (#16) (2026-06-11)

`lib/alerts/getAlertsInboxData.ts` is the alert/event **feed** — by R5,
`MachineEvent` is the correct source for alerting (not `ReasonEntry`), so no
downtime re-sourcing applies. Two checks:

- **R6 (windows)** — already correct. `pickRange` produces rolling windows and
  the response echoes `range: { range, start, end }`. Labels are `24h / 7d / 30d /
  custom` (honest rolling), never calendar `Hoy/Ayer`. No change needed.
- **R5 (display cap)** — the per-event `durationSec` (from `extractDurationSec`)
  was uncapped, so a runaway/never-resolved stoppage could show ~67 h in the
  inbox while the downtime-events list (#14) and financial (#13) show 12 h. Now
  capped at `MAX_OPEN_EPISODE_MS` (12 h) via `capEpisodeSec`, congruent with those.

`npm test` (32 golden tests) green; `tsc --noEmit` clean.
