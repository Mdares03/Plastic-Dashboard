-- The overview ETag computes MAX(ts_server) per org on every poll. With only
-- (orgId, machineId, ts_server) available, that MAX fell back to a full seq scan
-- (~150ms and growing with the table). This composite, with ts_server as the
-- second key, lets the planner backward-index-seek it in sub-ms.
CREATE INDEX "MachineKpiSnapshot_orgId_tsServer_idx" ON "MachineKpiSnapshot"("orgId", "ts_server");
