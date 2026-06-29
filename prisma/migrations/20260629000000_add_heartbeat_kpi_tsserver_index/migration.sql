-- Health checks fetch the latest heartbeat / KPI snapshot per machine ordered by
-- cloud-receive time (ts_server). The existing indexes are on `ts`, so those
-- ordered lookups scanned every row per machine instead of seeking. Add the
-- matching composite indexes so they become index seeks.
CREATE INDEX "MachineHeartbeat_orgId_machineId_tsServer_idx" ON "MachineHeartbeat"("orgId", "machineId", "ts_server");
CREATE INDEX "MachineKpiSnapshot_orgId_machineId_tsServer_idx" ON "MachineKpiSnapshot"("orgId", "machineId", "ts_server");
