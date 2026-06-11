# Phase 3 — current-rate freshness gate (#5, covers #4) (2026-06-11)

`lib/machines/withLatest.ts` is the shared "latest snapshot" layer behind every
**current/live** OEE tile: the overview (`getOverviewData`,
`getOverviewSummary`), the machines API (`app/api/machines/route.ts`), and the
machines list page (`app/(app)/machines/page.tsx`). Migrating it once fixes all
four surfaces — so call site #4 (overview) is covered here with no extra change.

## The bug (R4)

`fetchLatestKpis` returns each machine's most recent `MachineKpiSnapshot`
*regardless of age or production state*, and `mergeMachineOverviewRows` attached
its `oee/availability/performance/quality` to the live tile verbatim. So a
machine that stopped reporting hours ago kept showing its last OEE as if it were
the current number.

## The fix

`fetchLatestKpis` now also selects `trackingEnabled` / `productionStarted`, and
the merge runs the four rate fields through `getLatestRates` (R4): the live tile
shows them only if the latest snapshot is a **production** sample fresher than
`CURRENT_RATE_MAX_AGE_MS` (10 min); otherwise null → "—" (R7). Factual fields
(counts, cycleTime, sku, workOrderId) pass through unchanged.

## Verification (live, local prod DB)

`tsx scripts ... ` comparing raw latest-snapshot OEE vs the gated tile across all
orgs — **2 of 2 machines holding KPI snapshots changed**, both correctly:

| machine | raw "live" OEE | gated | snapshot age | tracking | prodStarted |
|---------|----------------|-------|--------------|----------|-------------|
| M4-2 | `0` | `—` | ~2358 min (≈39 h) | true | true |
| M4-5 | `100` | `—` | ~1390 min (≈23 h) | false | true |

Both were textbook trust-killers: a long-stale machine showing **0%** live OEE,
and a tracking-off machine showing **100%** live OEE. Neither is a live number;
both now read "—".

## Scope note

The machine-detail route (`app/api/machines/[machineId]/route.ts`, call site #6)
still builds its `latestKpi` directly from `kpiSnapshots[0]` and is **not** gated
yet — it is the next call site and will be aligned to the same R4 rule, after
which detail and list tiles agree by construction.

`npm test` (32 golden tests) green; `tsc --noEmit` clean.
