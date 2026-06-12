-- Phase 6 (P6.5): atomic outbox enqueue for the edge MariaDB (edge_outbox).
--
-- Today the flow does two separate DB calls: CALL next_seq (advances a counter)
-- then a separate INSERT into outbox_messages. A crash between them BURNS a seq —
-- the counter advances but no row carries it, leaving a permanent gap. This proc
-- does the whole thing in ONE transaction: derive the next per-machine seq, insert
-- the message, AND stamp the seq into payload_json.$.seq, all atomically. On any
-- error it rolls back, so nothing is half-applied and no seq is wasted.
--
-- SELF-CONTAINED BY DESIGN: the next seq is derived from the machine's own existing
-- rows (MAX(seq)+1), NOT from the Pi's `next_seq` proc / its counter table. This is
-- deliberate — we could not see next_seq's internals from the repo, and assuming a
-- counter-table name would risk a divergent second counter (duplicate seqs). Both
-- facts this relies on are verified from the flow itself (edge/flows.json):
--   • Columns: the flow's own "Insert outbox_messages" uses exactly
--     (machine_id, msg_type, endpoint, schema_version, seq, ts_device_ms,
--      payload_json, status, attempts, next_attempt_at).
--   • Retention: sent rows are UPDATEd to status='sent' (node "Mark Sent"); there is
--     NO DELETE/purge of outbox_messages anywhere in the flow → MAX(seq) never resets,
--     so a seq can never be reused. (CAVEAT: if outbox_messages is ever manually
--     TRUNCATEd, seq restarts at 1; don't truncate it. The pre-existing next_seq
--     counter is left untouched and simply goes unused.)
-- SELECT ... FOR UPDATE serializes concurrent enqueues for the same machine, so even
-- if two messages race the seq stays gap-free and unique.
--
-- The caller passes the envelope WITHOUT seq; the proc fills it in. The publisher
-- later reads payload_json from the table, so the POSTed payload still carries seq.
--
-- Apply on the Pi:  sudo mariadb edge_outbox < scripts/edge/outbox_enqueue.sql

DELIMITER ;;

CREATE OR REPLACE PROCEDURE outbox_enqueue(
  IN p_machine_id     CHAR(36),
  IN p_msg_type       VARCHAR(16),
  IN p_endpoint       VARCHAR(64),
  IN p_schema_version VARCHAR(16),
  IN p_ts_device_ms   BIGINT,
  IN p_payload_json   LONGTEXT
)
BEGIN
  DECLARE v_seq BIGINT;
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    RESIGNAL;
  END;

  START TRANSACTION;
    -- Next per-machine seq from this machine's own rows. FOR UPDATE locks the
    -- examined rows so concurrent enqueues can't pick the same seq.
    SELECT COALESCE(MAX(seq), 0) + 1 INTO v_seq
    FROM outbox_messages
    WHERE machine_id = p_machine_id
    FOR UPDATE;

    -- Insert the message, stamping the seq into both the column and the envelope.
    INSERT INTO outbox_messages
      (machine_id, msg_type, endpoint, schema_version, seq, ts_device_ms,
       payload_json, status, attempts, next_attempt_at)
    VALUES
      (p_machine_id, p_msg_type, p_endpoint, p_schema_version, v_seq, p_ts_device_ms,
       JSON_SET(p_payload_json, '$.seq', CAST(v_seq AS CHAR)), 'pending', 0, NULL);
  COMMIT;

  SELECT v_seq AS seq;
END ;;

DELIMITER ;
