-- Edge split (plan §D/§E): the Pi's view of the wireless ESP32 reader link on
-- heartbeats. Additive, all nullable. null = not a split machine / not reported.
--   reader_online        false → drives the DATA_LOSS machine state (reader dead, Pi up)
--   reader_clock_synced  the ESP32 had a valid clock offset (no-RTC sync, §E)
--   reader_buffer_depth  unacked edges buffered on the ESP32 (link-health signal)
-- Follows the P6.4 pattern: pre-existing index drifts are NOT touched here.
ALTER TABLE "MachineHeartbeat" ADD COLUMN "reader_online" BOOLEAN;
ALTER TABLE "MachineHeartbeat" ADD COLUMN "reader_clock_synced" BOOLEAN;
ALTER TABLE "MachineHeartbeat" ADD COLUMN "reader_buffer_depth" INTEGER;
