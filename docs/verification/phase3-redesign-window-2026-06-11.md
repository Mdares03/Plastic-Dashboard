# Phase 3 — redesign.ts window migration (#2) (2026-06-11)

`lib/recap/redesign.ts` (recap machine-detail + summary path). The KPI numbers
here already flow from the Phase-3 #1 migration of `getRecapData` (oee /
production / downtime read off the `machine.*` object), so this call site's
remaining duplication was the **window/timezone math (R6)**: redesign carried its
own copies of the DST-aware tz primitives (`parseOffsetMinutes`,
`getTzOffsetMinutes`, `zonedToUtcDate`) and its own "yesterday" resolver.

## Change

- Deleted redesign's three private tz primitives; it now imports
  `zonedToUtcDate` (shift math) and `resolveWindow` (yesterday) from
  `lib/metrics`. One implementation of the DST offset math, not several.
- "yesterday" detail range now routes through `resolveWindow({ mode: "yesterday" })`
  — the same calendar-yesterday every view resolves (R6 congruence).
- Applied the local-midnight "24" guard to redesign's remaining `getLocalParts`
  (kept only for the shift resolver's `weekday`/`minutesOfDay`, which
  `resolveWindow` delegates to the caller by design).

## Verification — equivalence + a bug caught in the authority

Sweeping every 7h instant across a full year × 5 timezones, old redesign
yesterday-math vs the new `resolveWindow` path diverged on exactly the two DST
transition days (6 instants, `America/New_York` / `Europe/Madrid`). Investigation
showed the **old redesign code was correct and `resolveWindow` had a latent DST
bug**: it stepped a fixed `-DAY_MS` back from today's midnight, which overshoots
into two-days-ago the day after spring-forward (yesterday is only 23h long). The
mirror bug existed in "today" for the 25h fall-back day.

Fixed `lib/metrics/window.ts` to step a half-day into the target day and snap to
its local midnight (DST-robust). After the fix the year-long sweep is identical
across all sampled instants/timezones. Two DST regression tests added to
`tests/metrics/window.test.ts`.

Bemis runs `America/Mexico_City` (no DST since 2022), so no live number moved —
but the authority module is now correct for every timezone, and the recap
"yesterday" tile is congruent-by-construction with reports.

`npm test` (32 golden tests) green; `tsc --noEmit` clean.
