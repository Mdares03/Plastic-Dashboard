-- Dedupe existing rows (keep oldest by createdAt, then id) before unique constraint.
WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "orgId", "machineId", "ts", "cycleCount"
      ORDER BY "createdAt" ASC, "id" ASC
    ) AS rn
  FROM "MachineCycle"
)
DELETE FROM "MachineCycle" mc
USING ranked r
WHERE mc."id" = r."id"
  AND r.rn > 1;

-- One row per (org, machine, device ts, cycle counter) — blocks retry / fan-out duplicates.
CREATE UNIQUE INDEX "MachineCycle_orgId_machineId_ts_cycleCount_key"
  ON "MachineCycle" ("orgId", "machineId", "ts", "cycleCount");
