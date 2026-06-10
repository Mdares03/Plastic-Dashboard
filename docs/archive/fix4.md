Task: Implement Control Tower changes only (no Node-RED edits), then run full verification with SQL + backfill script.

Repository context:
- Workspace root: Plastic-Dashboard
- Target branch assumption: sandbox-main
- Database: PostgreSQL via Prisma
- Scope strictly limited to Control Tower code and scripts in this repo

Hard constraints:
1. Do NOT edit any Node-RED flow files or Node-RED runtime code.
2. Do NOT change behavior outside the requested areas unless required for correctness.
3. Preserve existing non-authoritative guard behavior for downtime reasons (PENDIENTE / UNCLASSIFIED).
4. Run verification before and after backfill, and report results clearly.
5. If lint/test has unrelated pre-existing failures, do not refactor unrelated modules.

Implementation requirements:

A) Downtime continuity fallback key fix
File:
- app/api/ingest/event/route.ts

Goal:
- Ensure fallback downtime reason identity/continuity uses episode continuity key (incidentKey) whenever present.
- Use row.id only when incidentKey is truly absent.
- Preserve guard that prevents non-authoritative values from overwriting authoritative manual reasons.

Details:
1. In the event ingestion logic where ReasonEntry payload is created for downtime-like events (including fallback UNCLASSIFIED and mold-change):
- Derive a fallbackIncidentKey from available payload fields in this preference order:
  - evData.incidentKey
  - dataObj.incidentKey
  - evDowntime?.incidentKey
  - evReason?.incidentKey (if available)
- Only if all are missing, fallback to row.id.

2. For fallback reasonRaw objects:
- For mold-change fallback, set incidentKey to moldIncidentKey ?? fallbackIncidentKey ?? row.id.
- For unclassified fallback, set incidentKey to fallbackIncidentKey ?? row.id.

3. Create one continuityIncidentKey (single source of truth) used consistently for:
- downtime reasonId construction (evt:<machineId>:downtime:<continuityIncidentKey>)
- ReasonEntry episodeId for downtime
- meta.incidentKey in reason entry writes
- manual-preservation guard queries by episodeId

4. Keep non-authoritative guard semantics unchanged:
- incoming non-authoritative reason should not overwrite existing authoritative reason for same episode
- downtime-acknowledged/manual authoritative path remains preserved

B) OEE trend from production-only snapshots
File:
- app/api/reports/route.ts

Goal:
- Build OEE trend from production-only snapshots:
  - trackingEnabled = true
  - productionStarted = true
- Keep summary metrics behavior explicit and consistent with this filtering decision.

Details:
1. Include trackingEnabled and productionStarted in KPI snapshot select.
2. Add helper like isProductionSnapshot(trackingEnabled, productionStarted).
3. Compute OEE/Availability/Performance/Quality averages using production-only rows.
4. For trend generation:
- Iterate timeline in ts order.
- For non-production snapshots, emit null points (for OEE and related KPI lines) so chart can render true gaps.
- For production snapshots, emit actual numeric values (or null if value is missing).
5. Keep downtime/event aggregates and cycle-based totals behavior intact unless explicitly tied to OEE production-only requirement.
6. Keep logic explicit in code comments (short, concrete comments only where needed).

C) Chart rendering behavior: no smoothing across gaps
Files:
- app/(app)/reports/ReportsCharts.tsx
- app/(app)/reports/ReportsPageClient.tsx (if types/downsampling need updates)

Goal:
- OEE line interpolation must be linear.
- Gaps must be rendered as gaps (no fake continuity through filtered/non-production windows).

Details:
1. In OEE line chart:
- change Line type from monotone to linear
- set connectNulls={false}
2. Ensure frontend types allow nullable trend values for OEE points.
3. If downsampling exists, preserve gap markers so null separators are not removed.
- Keep null transition points when reducing point count.
4. Ensure tooltip/value formatting handles nulls gracefully.

Verification and execution steps:

1) Run targeted checks first
- run tests related to downtime guard if available:
  - npm run test:downtime-reason-guard
- run lint at least for changed files (or full lint if practical):
  - npx eslint app/api/ingest/event/route.ts app/api/reports/route.ts app/(app)/reports/ReportsCharts.tsx app/(app)/reports/ReportsPageClient.tsx

2) SQL Verification Pack (PRE-BACKFILL)
Execute these exactly and capture output snapshots:

A. Recent downtime reason quality mix
SELECT
  reasonCode,
  COUNT(*) AS rows
FROM "ReasonEntry"
WHERE kind = 'downtime'
  AND "capturedAt" >= NOW() - INTERVAL '7 days'
GROUP BY reasonCode
ORDER BY rows DESC;

B. Episodes with conflicting reason codes
SELECT
  "orgId",
  "machineId",
  "episodeId",
  COUNT(DISTINCT "reasonCode") AS distinct_codes,
  MIN("capturedAt") AS first_seen,
  MAX("capturedAt") AS last_seen
FROM "ReasonEntry"
WHERE kind = 'downtime'
  AND "episodeId" IS NOT NULL
  AND "capturedAt" >= NOW() - INTERVAL '14 days'
GROUP BY "orgId", "machineId", "episodeId"
HAVING COUNT(DISTINCT "reasonCode") > 1
ORDER BY last_seen DESC
LIMIT 200;

C. Potential manual overwritten by non-authoritative check
SELECT
  re."orgId",
  re."machineId",
  re."episodeId",
  re."reasonCode",
  re."capturedAt",
  re.meta
FROM "ReasonEntry" re
WHERE re.kind = 'downtime'
  AND re."capturedAt" >= NOW() - INTERVAL '14 days'
  AND re."reasonCode" IN ('PENDIENTE', 'UNCLASSIFIED')
ORDER BY re."capturedAt" DESC
LIMIT 200;

D. Event continuity around downtime + ack
SELECT
  "machineId",
  "eventType",
  ts,
  data->>'incidentKey' AS incident_key,
  data->>'status' AS status,
  data->>'is_update' AS is_update,
  data->>'is_auto_ack' AS is_auto_ack
FROM "MachineEvent"
WHERE ts >= NOW() - INTERVAL '3 days'
  AND "eventType" IN ('microstop', 'macrostop', 'downtime-acknowledged')
ORDER BY ts DESC
LIMIT 500;

E. KPI production vs non-production counts
SELECT
  COALESCE("trackingEnabled", false) AS tracking_enabled,
  COALESCE("productionStarted", false) AS production_started,
  COUNT(*) AS rows
FROM "MachineKpiSnapshot"
WHERE ts >= NOW() - INTERVAL '7 days'
GROUP BY 1,2
ORDER BY rows DESC;

F. Sharp OEE jumps in production snapshots
WITH k AS (
  SELECT
    "machineId",
    ts,
    oee,
    LAG(oee) OVER (PARTITION BY "machineId" ORDER BY ts) AS prev_oee
  FROM "MachineKpiSnapshot"
  WHERE ts >= NOW() - INTERVAL '7 days'
    AND "trackingEnabled" = true
    AND "productionStarted" = true
    AND oee IS NOT NULL
)
SELECT
  "machineId",
  ts,
  prev_oee,
  oee,
  ABS(oee - prev_oee) AS delta
FROM k
WHERE prev_oee IS NOT NULL
  AND ABS(oee - prev_oee) >= 25
ORDER BY delta DESC, ts DESC
LIMIT 200;

G. Trend point count comparison
SELECT
  'all' AS series,
  COUNT(*) AS points
FROM "MachineKpiSnapshot"
WHERE ts >= NOW() - INTERVAL '24 hours'
  AND oee IS NOT NULL
UNION ALL
SELECT
  'production_only' AS series,
  COUNT(*) AS points
FROM "MachineKpiSnapshot"
WHERE ts >= NOW() - INTERVAL '24 hours'
  AND oee IS NOT NULL
  AND "trackingEnabled" = true
  AND "productionStarted" = true;

3) Backfill run plan (must follow this order)
A. Dry-run first:
node scripts/backfill-downtime-reasons.mjs --dry-run --since 30d

B. Review dry-run output:
- candidates
- sampleUpdates
- incident distribution by machine
- any suspicious replacements

C. Apply scoped first (single machine from dry-run sample):
node scripts/backfill-downtime-reasons.mjs --since 30d --machine-id <machine_uuid>

4) SQL Verification Pack (POST-BACKFILL)
- Re-run queries A, B, C at minimum.
- Optionally rerun D/F/G for confidence.
- Confirm reduction in stale PENDIENTE/UNCLASSIFIED rows where authoritative reason exists.
- Confirm conflicting episode reason cases reduced or shifted as expected.

Acceptance criteria checklist:
- New downtime episodes retain authoritative manual reason and do not regress to PENDIENTE/UNCLASSIFIED.
- Fallback downtime continuity now keys by incidentKey whenever available; row.id only when absent.
- OEE trend no longer shows implausible 0/100 jumps from non-production snapshots.
- OEE chart is linear and visually shows true gaps (no smoothing continuity across filtered windows).
- Backfill dry-run and scoped apply outputs are captured and reasonable.
- Post-run SQL confirms expected improvements without obvious regressions.

Output format required from you:
1. Files changed with concise reason per file.
2. Exact diff summary for each modified file.
3. Test/lint commands run + result.
4. Pre-backfill SQL results (compact tables or summarized counts).
5. Dry-run output summary (key fields + sample updates).
6. Scoped apply command used and output summary.
7. Post-backfill SQL delta summary (before vs after).
8. Any blockers (env vars, DB auth, migration state, etc.) and exactly what is needed to unblock.
