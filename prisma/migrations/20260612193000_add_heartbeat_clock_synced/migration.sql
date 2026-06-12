-- P6.4: edge clock-sync state on heartbeats (timedatectl NTPSynchronized).
-- Additive only. The `migrate diff` against the live DB also surfaced two
-- pre-existing index drifts (DROP INDEX MachineHeartbeat_orgId_machineId_ts_key
-- and MachineKpiSnapshot_orgId_machineId_ts_key) — those are DELIBERATELY EXCLUDED
-- here (they enforce snapshot/heartbeat uniqueness, relevant to R2) and tracked
-- separately. This migration changes nothing but the new nullable column.
ALTER TABLE "MachineHeartbeat" ADD COLUMN "clock_synced" BOOLEAN;
