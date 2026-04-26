-- Heartbeat: same device ts + machine = one row (retries / double POST).
WITH ranked_hb AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "orgId", "machineId", "ts"
      ORDER BY "ts_server" ASC, "id" ASC
    ) AS rn
  FROM "MachineHeartbeat"
)
DELETE FROM "MachineHeartbeat" h
USING ranked_hb r
WHERE h."id" = r."id"
  AND r.rn > 1;

CREATE UNIQUE INDEX "MachineHeartbeat_orgId_machineId_ts_key"
  ON "MachineHeartbeat" ("orgId", "machineId", "ts");

-- KPI snapshot: same minute bucket (device ts) per machine — Node-RED aligns ts to minute.
WITH ranked_kpi AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "orgId", "machineId", "ts"
      ORDER BY "ts_server" ASC, "id" ASC
    ) AS rn
  FROM "MachineKpiSnapshot"
)
DELETE FROM "MachineKpiSnapshot" k
USING ranked_kpi r
WHERE k."id" = r."id"
  AND r.rn > 1;

CREATE UNIQUE INDEX "MachineKpiSnapshot_orgId_machineId_ts_key"
  ON "MachineKpiSnapshot" ("orgId", "machineId", "ts");
