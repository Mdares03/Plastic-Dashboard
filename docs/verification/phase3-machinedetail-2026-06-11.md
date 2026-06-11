# Phase 3 — machine-detail route migration (#6) (2026-06-11)

`app/api/machines/[machineId]/route.ts` carried three duplicated pieces the
authority now owns:

1. **Four event parsers** (`eventDataObject`, `isTruthyFlag`,
   `activeEpisodeStartMs`, `resolvedEpisodeEndMs`) — byte-for-byte copies of
   `lib/metrics/events.ts`. Deleted; the route no longer parses events itself.
2. **The live-state ladder** (offline > mold-change > startup-wait > stopped >
   microstop > running > idle). `lib/metrics/machineState.deriveMachineState`
   was *extracted verbatim from this very route* in Phase 1; this commit calls it
   back, so the detail row, the machines list, and recap all pulse from one
   implementation (R8).
3. **Ungated `latestKpi`** — built directly from `kpiSnapshots[0]`, so detail
   showed a stale/non-production OEE while the list (#5) already blanked it.
   Now gated through the shared `gateLatestKpi` (R4), so detail and list agree
   by construction.

## Verification

**State (R8) — live, local prod DB.** Replayed the old inline ladder vs
`deriveMachineState` for all 5 machines using the route's exact event/cycle
windows (21600s events, 3600s cycles): **identical for all 5**. (All machines are
currently `offline` — paused pilot — so the non-offline branches are covered by
the `machineState.test.ts` golden suite, not live data.)

**Rates (R4).** Same gate as #5; M4-2 / M4-5 detail tiles now blank to "—"
exactly as their list tiles do (see phase3-latestrates-2026-06-11.md).

`npm test` (32 golden tests) green; `tsc --noEmit` clean. Net −150 lines from the
route (duplicated parsers + ladder removed).
