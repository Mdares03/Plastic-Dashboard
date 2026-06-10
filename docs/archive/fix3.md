The fix created the production segment, but the mold-change active event never got a matching resolved event in CT. Two checks will tell us which.

On CT Postgres
SELECT ts, data->>'status' AS status,
       data->>'incidentKey' AS ikey,
       data->>'is_update' AS is_update
FROM "MachineEvent"
WHERE "machineId" = '<uuid-M4-5>'
  AND "eventType" = 'mold-change'
ORDER BY ts DESC LIMIT 10;
Expected when working: active + resolved rows with same incidentKey.

If only active exists → resolved event never reached CT. Likely causes:

Flow wasn't redeployed after the edit (Node-RED still running old version — check if node.warn in auto-close is firing in debug sidebar).
state.moldChange persisted stale from before (cleared active manually somewhere).
User hit COMENZAR before deploying the updated flow → no close event ever emitted for that episode.
If both exist but incidentKey differs → my close event and start event used different startMs. Send me both rows and I'll trace.

Manual cleanup for the stuck episode
Until a new resolved event arrives, the banner won't clear. Force it:

-- Insert a synthetic resolved event matching the stuck active one
INSERT INTO "MachineEvent" (id, "orgId", "machineId", ts, topic, "eventType", severity, "requiresAck", title, description, data, "createdAt")
SELECT gen_random_uuid(), "orgId", "machineId", NOW(), 'mold-change', 'mold-change', 'info', false,
       'Cambio de molde cerrado manualmente', 'cierre manual',
       jsonb_build_object(
         'status','resolved',
         'incidentKey', data->>'incidentKey',
         'start_ms', (data->>'start_ms')::bigint,
         'end_ms', extract(epoch from NOW())*1000
       ),
       NOW()
FROM "MachineEvent"
WHERE "machineId" = '<uuid-M4-5>' AND "eventType" = 'mold-change' AND data->>'status' = 'active'
ORDER BY ts DESC LIMIT 1;
Banner disappears on next recap refresh (cache 60s).

Permanent safeguard (CT)
In lib/recap/getRecapData.ts ~line 817, add a freshness cap: an "active" mold-change older than 12h is almost always stuck data. Treat as resolved:

const STALE_ACTIVE_MS = 12 * 60 * 60 * 1000;
for (const event of machineMoldEvents) {
  const key = eventIncidentKey(event.data, "mold-change", event.ts);
  const status = eventStatus(event.data);
  if (status === "resolved") { moldActiveByIncident.delete(key); continue; }
  if (status === "active" || !status) {
    // ignore if too old to be real
    if (params.end.getTime() - event.ts.getTime() > STALE_ACTIVE_MS) continue;
    moldActiveByIncident.set(key, moldStartMs(event.data, event.ts));
  }
}
Same for the timeline extension logic in lib/recap/timeline.ts line 662 — cap isFreshActive at the same threshold.

