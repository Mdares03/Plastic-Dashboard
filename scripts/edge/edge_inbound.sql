-- Edge split E2 (plan §B): durable inbound dedup for ESP32 -> Pi edges.
--
-- Mirror of the Pi->cloud outbox, inbound. The ESP32 ships timestamped relay edges
-- with a per-device monotonic `seq`; this is where the Pi durably records them,
-- dedupes replays, and computes the ack high-water mark it sends back so the ESP32
-- can trim its flash buffer.
--
-- Two tables + one atomic proc:
--   edge_inbound      raw deduped edges (UNIQUE(machine_id, seq)) — also a replay/debug log
--   edge_ack_state    per-machine highest CONTIGUOUS seq (the safe ack water mark)
--
-- The ack is the highest seq S such that every seq 1..S has been stored — NOT just
-- max(seq). The ESP32 trims everything <= ackSeq, so acking past a gap would drop
-- edges the Pi never received. Advancing contiguously prevents that.
--
-- Apply on the Pi:  sudo mariadb edge_outbox < scripts/edge/edge_inbound.sql

CREATE TABLE IF NOT EXISTS edge_inbound (
  id           BIGINT AUTO_INCREMENT PRIMARY KEY,
  machine_id   CHAR(36)    NOT NULL,
  seq          BIGINT      NOT NULL,
  channel      TINYINT     NOT NULL DEFAULT 0,
  level        TINYINT     NOT NULL,
  ts_device_ms BIGINT      NOT NULL,           -- absolute UTC ms from the ESP32
  clock_synced TINYINT(1)  NOT NULL DEFAULT 0, -- ESP32 had a valid offset when stamped
  received_at  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_inbound_machine_seq (machine_id, seq),
  KEY idx_inbound_machine_seq_lookup (machine_id, seq)
);

CREATE TABLE IF NOT EXISTS edge_ack_state (
  machine_id          CHAR(36) PRIMARY KEY,
  last_contiguous_seq BIGINT NOT NULL DEFAULT 0,
  updated_at          DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

DELIMITER ;;

CREATE OR REPLACE PROCEDURE edge_inbound_ingest(
  IN  p_machine_id   CHAR(36),
  IN  p_seq          BIGINT,
  IN  p_channel      TINYINT,
  IN  p_level        TINYINT,
  IN  p_ts_device_ms BIGINT,
  IN  p_clock_synced TINYINT
)
BEGIN
  DECLARE v_is_new TINYINT DEFAULT 0;
  DECLARE v_cur    BIGINT  DEFAULT 0;
  DECLARE v_exists INT     DEFAULT 0;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    RESIGNAL;
  END;

  START TRANSACTION;
    -- Dedup: replays of an already-stored seq are ignored.
    INSERT IGNORE INTO edge_inbound
      (machine_id, seq, channel, level, ts_device_ms, clock_synced)
    VALUES
      (p_machine_id, p_seq, p_channel, p_level, p_ts_device_ms, p_clock_synced);
    SET v_is_new = ROW_COUNT(); -- 1 inserted, 0 duplicate

    -- Ensure an ack-state row, then lock it for the contiguous advance.
    INSERT INTO edge_ack_state (machine_id) VALUES (p_machine_id)
      ON DUPLICATE KEY UPDATE machine_id = machine_id;
    SELECT last_contiguous_seq INTO v_cur
      FROM edge_ack_state WHERE machine_id = p_machine_id FOR UPDATE;

    -- Advance the water mark over every now-contiguous stored seq.
    advance: LOOP
      SELECT COUNT(*) INTO v_exists
        FROM edge_inbound WHERE machine_id = p_machine_id AND seq = v_cur + 1;
      IF v_exists = 0 THEN LEAVE advance; END IF;
      SET v_cur = v_cur + 1;
    END LOOP;

    UPDATE edge_ack_state SET last_contiguous_seq = v_cur WHERE machine_id = p_machine_id;
  COMMIT;

  -- Caller publishes ack_seq to mis/edge/<id>/ack; forwards the edge only if new.
  SELECT v_is_new AS is_new, v_cur AS ack_seq;
END ;;

DELIMITER ;
