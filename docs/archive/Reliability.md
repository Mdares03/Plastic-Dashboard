Data Reliability — Handoff Prompt
Problem
Same machine shows different numbers in 3 places:

Home UI (Node-RED): goodParts=353, OEE=77.9%
Recap: goodParts=185, OEE=56%
Machine detail: OEE=4.3%, "Sin datos" in 1h timeline
Root cause: each view queries a different table with different logic. No single source of truth.

Rule: pick one source per metric, reuse across views
Metric	Authoritative source	Why
goodParts, scrapParts (per WO)	MachineWorkOrder.good_parts / scrap_parts	Node-RED writes this via UPDATE work_orders SET .... It's what Home UI shows.
cycleCount	MachineWorkOrder.cycle_count	Same reason.
oee / availability / performance / quality	time-weighted avg of MachineKpiSnapshot rows in window	Snapshots are minute-by-minute; Node-RED already sends them. Don't recompute.
Stops (count, duration)	MachineEvent filtered by eventType IN (microstop, macrostop, mold-change) + data->>'status' != 'active' + !is_update && !is_auto_ack	Deduped at source.
Timeline segments	UNION of: MachineWorkOrder status spans, MachineEvent (mold-change/micro/macro), filled with idle	Only way to get continuous coverage.
Backend changes
/api/recap/[machineId]/route.ts and /api/recap/summary/route.ts
goodParts aggregation — stop summing MachineCycle.good_delta. Instead:

// For window [start, end], sum good_parts from WOs that had activity in window
const wos = await prisma.machineWorkOrder.findMany({
  where: { machineId, orgId, updatedAt: { gte: start } },
  select: { workOrderId: true, sku: true, good_parts: true, scrap_parts: true, target_qty: true, status: true, updatedAt: true }
});
const goodParts = wos.reduce((s, w) => s + (w.good_parts ?? 0), 0);
const scrapParts = wos.reduce((s, w) => s + (w.scrap_parts ?? 0), 0);
Optionally scope to WOs that were RUNNING during the window; but for 24h window this rarely matters.

OEE aggregation — time-weighted average:

const snaps = await prisma.machineKpiSnapshot.findMany({
  where: { machineId, orgId, ts: { gte: start, lte: end } },
  orderBy: { ts: 'asc' },
  select: { ts: true, oee: true, availability: true, performance: true, quality: true }
});

function weightedAvg(field: 'oee' | 'availability' | 'performance' | 'quality') {
  if (snaps.length === 0) return null;
  let totalMs = 0, sum = 0;
  for (let i = 0; i < snaps.length; i++) {
    const nextTs = (snaps[i+1]?.ts ?? end).getTime();
    const dt = Math.max(0, nextTs - snaps[i].ts.getTime());
    sum += (snaps[i][field] ?? 0) * dt;
    totalMs += dt;
  }
  return totalMs > 0 ? sum / totalMs : null;
}
Return null (not 0, not 100) when no snapshots. Frontend renders — for null.

Stops aggregation — filter properly:

const stops = await prisma.machineEvent.findMany({
  where: {
    machineId, orgId,
    ts: { gte: start, lte: end },
    eventType: { in: ['microstop','macrostop'] },
  }
});
const real = stops.filter(e => {
  const d = e.data as any;
  return d?.status !== 'active' && !d?.is_auto_ack && !d?.is_update;
});
const stopsCount = real.length;
const stopsMin = real.reduce((s, e) => s + (((e.data as any)?.stoppage_duration_seconds ?? 0) / 60), 0);
/api/recap/[machineId]/timeline — MUST include mold-change
Segment builder in priority order (higher priority wins when overlapping):

mold-change segments (pair active→resolved by incidentKey, duration from data.duration_sec)
macrostop segments (same pairing)
microstop segments (merge runs <60s apart into cluster)
production segments — derived from WO status history, use MachineWorkOrder.status transitions + MachineCycle density (no cycles for >threshold → not production)
idle gap-fill
Never return empty array if any event exists in window. "Sin datos" only if literally zero rows in both MachineEvent and MachineCycle for the window.

Merge rules:

Same-type consecutive segments separated by <30s → merge
Any segment <30s duration, absorb into neighbor
Return format:

{
  range: { start, end },
  segments: Array<{
    type: 'production' | 'mold-change' | 'macrostop' | 'microstop' | 'idle',
    startMs, endMs, durationSec,
    label?: string,        // WO id, mold ids, reason
    workOrderId?: string,
    sku?: string,
    reasonLabel?: string,
  }>,
  hasData: boolean  // false only if literally empty
}
Frontend changes
RecapMachineCard.tsx / Machine detail page / OverviewTimeline.tsx
All three MUST consume the same endpoint and render from the same shape. Timeline in Machine detail page (app/(app)/machines/[machineId]/MachineDetailClient.tsx) currently queries its own source — refactor to call /api/recap/[machineId]/timeline with range=1h for the small timeline, range=24h for the recap.

"Sin datos" fallback: render only when hasData === false. If timeline has any mold-change or stop segment, render the bar.

Null handling for OEE
If backend returns oee: null:

<div className="text-2xl font-semibold text-zinc-400">—</div>
<div className="text-xs text-zinc-500">Sin datos de KPI</div>
Not 0.0%. Not 100%. Dash. User knows "no data" vs. "bad performance".

Reconciling with Home UI live numbers
Home UI reads live state.activeWorkOrder.goodParts from Node-RED. Recap reads MachineWorkOrder.good_parts from CT DB.

These WILL briefly differ because of outbox lag (cycle POST → DB insert → next recap query). Mitigate:

Cache recap endpoints 30-60s max (shorter than current 2-5 min).
On recap header, show "Actualizado hace Xs" timestamp so user sees freshness.
Pi cycle outbox should already be fast (<5s normally). If backlog is persistent, flag it in the UI with a "CT desincronizado" warning (compare MachineHeartbeat.ts to now; if >5min, show amber status).
Sanity check queries for debugging
Run on CT to audit one machine:

-- Authoritative WO state (matches Home UI)
SELECT work_order_id, sku, good_parts, scrap_parts, cycle_count, status, "updatedAt"
FROM "MachineWorkOrder"
WHERE "machineId" = '<uuid>'
ORDER BY "updatedAt" DESC LIMIT 5;

-- What KPI snapshots exist in last 24h
SELECT ts, oee, availability, performance, quality
FROM "MachineKpiSnapshot"
WHERE "machineId" = '<uuid>' AND ts > NOW() - INTERVAL '24 hours'
ORDER BY ts DESC LIMIT 20;

-- Events breakdown
SELECT "eventType",
       COUNT(*) AS total,
       COUNT(*) FILTER (WHERE data->>'status' = 'active') AS active,
       COUNT(*) FILTER (WHERE (data->>'is_update')::bool) AS updates,
       COUNT(*) FILTER (WHERE (data->>'is_auto_ack')::bool) AS auto_acks
FROM "MachineEvent"
WHERE "machineId" = '<uuid>' AND ts > NOW() - INTERVAL '24 hours'
GROUP BY "eventType";
If MachineWorkOrder.good_parts says 353 and Home UI says 353 but recap says 185 → recap is still using old aggregation.
If MachineKpiSnapshot count is 0 for last hour → Node-RED isn't sending snapshots (check outbox).

Checklist
not done
Recap endpoints use MachineWorkOrder.good_parts not cycle sum
not done
OEE uses time-weighted MachineKpiSnapshot avg, returns null when empty
not done
Timeline includes mold-change events
not done
Machine detail timeline uses same endpoint as recap
not done
"Sin datos" fallback only when hasData: false
not done
Null OEE renders as —, not 0 or 100
not done
Same endpoint feeds recap grid mini timeline + detail full timeline
not done
Cache TTL reduced to 30-60s
not done
Staleness indicator visible in UI header
Non-goals: no schema changes, no Node-RED changes, no new ingest endpoints