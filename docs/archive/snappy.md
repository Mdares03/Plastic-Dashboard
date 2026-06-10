# Snappy UX plan (Next.js)

## Goals
- Make every navigation feel instant (<50ms feedback) via loading UI and disabled re-clicks.
- Reduce server and data latency for heavy pages (Overview, Reports).
- Keep data accurate while allowing slight staleness for Settings/Financial (seconds).

## Constraints
- Data-heavy pages with large payloads and expensive queries.
- Users click multiple times when no feedback is shown.

## Success targets
- Navigation feedback in <50ms (loading/skeleton/pending state).
- P95 server response under 300-500ms for most queries; worst cases hidden behind progressive loading.
- No multi-click queueing; one navigation at a time.

---

## Phase 1: Audit and baseline (completed)

### What was instrumented
- Server timing + payload logging on Overview, Reports, Reports Filters, Machines APIs.
- Per-step timings inside `getOverviewData` (machines query, events query, normalize/filter).
- Client nav timing hooks were added but not captured due to service env/build config.

### Baseline results (from `/tmp/mis-control-tower.log`)
- Aggregate stats (cold + warm averaged)
  - Client nav (`perf.client` nav duration)
    - Avg: ~38ms; p50: ~51ms; p95: ~67ms; min: ~5ms; max: ~82ms.
  - Overview API (`/api/overview`) total
    - Avg: ~3.07s; p50: ~1.73s; p95: ~8.61s; min: ~1.20s; max: ~21.54s.
  - `getOverviewData` total
    - Avg: ~1.29s; p50: ~1.26s; p95: ~1.35s; min: ~1.15s; max: ~2.41s.
  - Machines query (inside Overview)
    - Avg: ~1.27s; p50: ~1.25s; p95: ~1.33s; min: ~1.13s; max: ~2.38s.
  - Machines API (`/api/machines`) total
    - Avg: ~1.26s; p50: ~1.25s; p95: ~1.36s; min: ~1.13s; max: ~1.52s.
  - Reports API (`/api/reports`) total
    - Avg: ~3.81s; p50: ~468ms; p95: ~18.14s; min: ~168ms; max: ~26.56s.
  - Reports filters (`/api/reports/filters`) total
    - Avg: ~4.07s; p50: ~367ms; p95: ~16.61s; min: ~57ms; max: ~23.78s.
  - Reports payload size
    - Avg: ~406KB; p50: ~406KB; p95: ~407KB.

- Overview (`/api/overview`)
  - Total: ~1.3–2.5s across samples (best ~1.2s, spikes up to ~2.5s).
  - `getOverviewData` total: ~1.15–1.36s typically; one sample ~2.4s.
  - **Machines query dominates**: ~1.12–1.33s (primary bottleneck).
  - Events query: ~5–35ms (minor).
  - Payload: ~13KB.

- Machines (`/api/machines`)
  - Total: ~1.15–1.33s per call for 3 machines.
  - **Machines query dominates**: ~1.15–1.33s.
  - Payload: ~1.6KB.

- Reports (`/api/reports`)
  - Typical total: ~170–225ms (later runs), earlier spikes up to ~16s (pre-fix or cold).
  - Query timings combined: ~130–200ms.
  - Row counts: ~1.8k KPI rows, ~6.2k cycles, ~736 events.
  - **Payload size ~406KB** (largest).

- Reports filters (`/api/reports/filters`)
  - Typical total: ~56–68ms (later runs), earlier spikes up to ~23s (pre-fix or cold).
  - Query timings: ~30–40ms.
  - Payload: ~51B.

### Findings
- The dominant latency contributor is the **machines query** used by Overview and Machines endpoints.
- Reports payload is large (~406KB), which impacts UI responsiveness even when queries are moderate.
- Large outliers (multi-second totals) likely come from non-query overhead (session lookup, DB connection wait, or cold start); these need targeted checks.
- Reports and reports filters show totals that are far larger than the summed query timings, confirming significant overhead outside the measured DB queries.
- Client end-to-end nav timing (`perf.client`) is now captured; p95 is ~67ms, slightly above the 50ms target.
- Baseline summaries should average cold and warm samples together for now.

### Data captured
- Logs are stored at `/tmp/mis-control-tower.log`.
- Events include: `perf.overview.api`, `perf.overview.getOverviewData`, `perf.machines.api`, `perf.reports.api`, `perf.reports.filters`.

Update
- Client nav timing is now captured via `/api/debug/perf` (`perf.client` events).
- API timings now include auth/preQuery/postQuery with coldStart/uptimeMs when enabled.

---

## Phase 2: Instant feedback (UX)

### 1) Global route loading
- Add `app/(app)/loading.tsx` with a lightweight skeleton for the shell.
- Ensure each heavy route also has its own `loading.tsx` for targeted skeletons.

### 2) Sidebar pending state
- Use `useTransition` to mark a pending navigation.
- Disable repeated clicks and show a subtle spinner on the active item.
- Optional: debounce repeated clicks for 300-500ms.

### 3) Suspense boundaries
- Wrap the slowest sections (events, charts, tables) in `<Suspense>` with skeletons.
- Ensure initial shell renders immediately even if data is still loading.

Deliverables
- Users always see visual feedback within a single frame.
- Double-clicks do not queue up extra navigations.

Progress
- Added route-level loading skeletons for the app shell and heavy routes.
- Sidebar uses `useTransition` with a pending spinner and blocks repeat clicks.
- Added Suspense + lazy loading for the Overview timeline and Reports charts.

---

## Phase 3: Split heavy pages (Overview + Reports)

### Overview (split)
- First paint: show lightweight summary data (machines list + latest heartbeat + tiny event count).
- Defer: fetch full event stream and detailed KPIs via client API after initial render.
- Use an explicit "Load more" or lazy loading for event details.

Implementation sketch
- Create a `getOverviewSummary` for the initial server render.
- Create a client fetch (`/api/overview?detail=1`) for detailed events and charts.
- Replace large data arrays with preview-sized payloads.

Progress
- Overview now uses `getOverviewSummary` for first paint, and `/api/overview?detail=1` for deferred detail fetch.
- Summary responses are cached in-memory with TTL + in-flight de-dupe (`perf.overview.summary` shows cache hits).
- Reports charts are lazy-loaded with placeholders; heavy chart blocks render after the shell.

### Reports (split)
- Render the report shell and filters immediately.
- Lazy-load heavy charts with `next/dynamic` and loading placeholders.
- Fetch chart data on demand (per chart or on viewport with IntersectionObserver).
- Paginate any large tables or use virtualization.

Deliverables
- Overview/Reports initial response is fast and small.
- Deep detail loads after the UI is already visible.

---

## Phase 4: Caching + data freshness

### 1) Page-level caching
- Remove `force-dynamic` where it is not required.
- Use `revalidate` on pages that can be stale for a few seconds (Settings, Financial).

### 2) Data cache for Prisma queries
- Wrap stable fetchers in `unstable_cache` with short TTL and tags (per org).
- Add manual refresh button on Settings/Financial to bypass cache when needed.

### 3) API cache headers
- Use `ETag` and `If-None-Match` where possible.
- For logged-in data, use `private` caching with short max-age.

Deliverables
- Fewer full recomputes for repeated navigations.
- Settings/Financial feel instant, but still correct.

Progress
- Added session cache + throttled `lastSeenAt` updates to reduce auth overhead spikes.
- Added cached GETs with short TTL + per-org tags for Settings + Financial config/impact.
- Added refresh bypass (`?refresh=1`) and a refresh button on Financial.
- Added ETag + private cache headers for Settings + Financial config, plus private cache headers for Financial impact.
- Restored `force-dynamic` on the authenticated layout to avoid static render errors from `cookies()`.

---

## Phase 5: Query + payload tuning

- Reduce `select` fields to only what the UI needs on first render.
- Cap `take` sizes with clear UI controls to load more.
- Add indexes for `orgId + ts` combos used in orderBy filters.
- Consider summary tables for expensive aggregations.

Progress
- Split machine fetch into base + latest heartbeat/KPI queries to avoid nested relation orderBy/take on large tables.
- Added indexes for heartbeat tsServer lookup and machine ordering by orgId + createdAt.
- Machines base query dropped to low ms; new hotspots are latest heartbeat (~250-300ms) and latest KPI (~800-900ms).
- Overview/Machines now log `heartbeatsQuery` + `kpiQuery` to track the new bottlenecks.

---

## What helped most
- Overview split + summary cache: repeat navigations are instant and detail loads later.
- Route-level loading + pending state: immediate feedback reduced double-clicks.
- Session cache + throttled lastSeen: reduced non-query overhead spikes.
- Short TTL caches with refresh bypass: Settings/Financial feel instant without losing correctness.
- Query shape changes: removed nested relation ordering and shifted load to targeted queries.

## Methodology / optimization strategy
- Instrument first, measure cold + warm, and store logs.
- Use timing breakdowns to find the dominant step.
- Improve perceived performance early (skeletons, pending state).
- Split payloads into summary + deferred detail.
- Cache low-risk data with short TTL + refresh bypass and ETag for 304s.
- Tune queries with smaller selects, indexes, and safer query shapes; consider denormalizing if needed.

## Validation
- Measure navigation feedback time (click to loading UI). Goal: <50ms.
- Track p95 TTFB and payload size for Overview and Reports before/after.
- Confirm that repeated clicks no longer add latency or duplicated requests.

---

## Open opportunities
- Optimize latest KPI query (index on `orgId + machineId + tsServer` or denormalize latest KPI onto `Machine`).
- Reduce Reports payload size (trim fields, paginate, or virtualize tables).
- Consider summary tables/materialized views for heavy aggregates.

## Further implementation plan (later)
1) Latest KPI/heartbeat acceleration
   - Add index for KPI lookups by server time: `@@index([orgId, machineId, tsServer])`.
   - Switch KPI “latest” ordering to `tsServer` to match index.
   - Optional: denormalize `latestHeartbeat` + `latestKpi` onto `Machine` and update on ingest.
   - Add background backfill job for legacy machines.

2) Machines + Overview caching
   - Increase summary cache TTL (30-60s) to raise hit rates.
   - Add per-org cache invalidation when a heartbeat/KPI ingests.
   - Add ETag handling to `/api/machines` (similar to overview detail).

3) Reports payload trim
   - Reduce fields in `reports` response to the chart/minimum.
   - Add pagination for large tables (KPIs/cycles/scrap).
   - Add “Download full dataset” endpoint separate from UI view.

4) Connection + ORM tuning
   - Enable Prisma query logging to identify slow SQL.
   - Evaluate connection pool size and cold-start behavior in serverless.
   - Move heavy aggregates to `GROUP BY` at DB level with indexes.

5) UX refinements
   - Add inline “last updated” timestamp in Overview/Reports headers.
   - Show cache-hit badges when content is served from cache.
   - Add optional “refresh” on the overview to re-fetch detail data.
