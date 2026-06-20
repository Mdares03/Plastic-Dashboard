-- =============================================================================
-- control_tower_db retention + rollups
-- Owner: mdares (no superuser needed to create these objects).
-- Idempotent: safe to re-run. Scheduling is wired separately (pg_cron or host cron).
--
-- Policy (chosen 2026-06-20):
--   IngestLog          : keep 14 days   (error logs only)
--   MachineKpiSnapshot : keep 30 days   (raw per-tick KPI)
--   MachineHeartbeat   : keep 30 days
--   MachineCycle       : keep 365 days  (production record; rolled up daily first)
--   MachineEvent       : keep 365 days  (event/audit record)
-- Rollups (kept indefinitely): oee_daily, built from MachineCycle deltas.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Daily production rollup (kept forever; lets us drop raw cycles after 1y
-- without losing good/scrap/throughput history). Only aggregates UNAMBIGUOUS
-- per-cycle deltas — OEE/availability are intentionally left to the app, which
-- recomputes them from raw cycles within the 365d window.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS oee_daily (
  org_id          text        NOT NULL,
  machine_id      text        NOT NULL,
  day             date        NOT NULL,
  good            bigint      NOT NULL DEFAULT 0,
  scrap           bigint      NOT NULL DEFAULT 0,
  cycle_count     bigint      NOT NULL DEFAULT 0,
  avg_cycle_time  double precision,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, machine_id, day)
);

-- Recompute rollups for the last N days (default 2: yesterday + today so a late
-- cycle is captured). Re-runnable; uses UPSERT.
CREATE OR REPLACE FUNCTION app_rollup_oee_daily(p_days int DEFAULT 2)
RETURNS void LANGUAGE sql AS $$
  INSERT INTO oee_daily (org_id, machine_id, day, good, scrap, cycle_count, avg_cycle_time, updated_at)
  SELECT "orgId", "machineId", (ts AT TIME ZONE 'UTC')::date AS day,
         COALESCE(SUM("goodDelta"), 0),
         COALESCE(SUM("scrapDelta"), 0),
         COUNT(*),
         AVG(NULLIF("actualCycleTime", 0)),
         now()
  FROM "MachineCycle"
  WHERE ts >= (now() - make_interval(days => p_days))
  GROUP BY "orgId", "machineId", (ts AT TIME ZONE 'UTC')::date
  ON CONFLICT (org_id, machine_id, day) DO UPDATE
    SET good = EXCLUDED.good,
        scrap = EXCLUDED.scrap,
        cycle_count = EXCLUDED.cycle_count,
        avg_cycle_time = EXCLUDED.avg_cycle_time,
        updated_at = now();
$$;

-- ---------------------------------------------------------------------------
-- Batched retention delete. Batching keeps each transaction small so the delete
-- never floods WAL / blocks the live ingest path (learned the hard way:
-- one giant DELETE stalls on WALWrite under concurrent load).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION app_retention_delete(
  p_table text, p_ts_col text, p_keep_days int, p_batch int DEFAULT 5000
) RETURNS bigint LANGUAGE plpgsql AS $$
DECLARE
  v_deleted bigint := 0;
  v_n       bigint;
BEGIN
  LOOP
    EXECUTE format(
      'WITH d AS (DELETE FROM %I WHERE ctid IN '
      '(SELECT ctid FROM %I WHERE %I < now() - make_interval(days => $1) LIMIT $2) '
      'RETURNING 1) SELECT count(*) FROM d',
      p_table, p_table, p_ts_col
    ) INTO v_n USING p_keep_days, p_batch;
    v_deleted := v_deleted + v_n;
    EXIT WHEN v_n < p_batch;
  END LOOP;
  RETURN v_deleted;
END; $$;

-- One entry point the scheduler calls. Roll up first, then prune.
CREATE OR REPLACE FUNCTION app_retention_run() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  PERFORM app_rollup_oee_daily(2);
  PERFORM app_retention_delete('IngestLog',          'tsServer', 14);
  PERFORM app_retention_delete('MachineKpiSnapshot', 'ts',       30);
  PERFORM app_retention_delete('MachineHeartbeat',   'ts',       30);
  PERFORM app_retention_delete('MachineCycle',       'ts',       365);
  PERFORM app_retention_delete('MachineEvent',       'ts',       365);
END; $$;
