// Edge split E2 (plan §C) — "Edge Inbound: ack + forward" function node.
// IN:  the mysql node result of edge_inbound_ingest  → { is_new, ack_seq }
// OUT 1 (top): → existing "function 1" (d8b64d16026af66d) — ONLY when the edge is new
// OUT 2 (bot): → mqtt-out, topic mis/edge/<id>/ack — ALWAYS (so the ESP32 can trim)
//
// The forwarded message mimics the old rpi-gpio output: msg.payload = level (0/1),
// plus msg.tsDevice (absolute UTC) and msg.machineId for the device-time logic (E3).

const e = msg._edge || {};

// Parse { is_new, ack_seq } from the CALL result (mysql returns nested arrays for CALL).
let isNew = null, ackSeq = null;
const res = msg.payload;
if (Array.isArray(res)) {
    const row = (Array.isArray(res[0]) ? res[0][0] : res[0]) || {};
    if (row.is_new != null) isNew = Number(row.is_new);
    if (row.ack_seq != null) ackSeq = Number(row.ack_seq);
}

// Always ack the high-water seq so the ESP32 can drain its flash buffer.
let ackMsg = null;
if (e.machineId && ackSeq != null) {
    ackMsg = {
        topic: "mis/edge/" + e.machineId + "/ack",
        payload: JSON.stringify({ ackSeq: ackSeq }),
    };
}

// Forward into the cycle pipeline only for a genuinely new edge (dedup gate).
let fwd = null;
if (isNew === 1) {
    fwd = {
        payload: e.level,          // function 1 does Number(msg.payload)
        tsDevice: e.tsDevice,      // absolute UTC ms — Machine cycles uses this (E3)
        machineId: e.machineId,
        clockSynced: e.clockSynced === 1,
    };
}

node.status({ fill: isNew === 1 ? "green" : "grey", shape: "dot",
              text: "seq " + (e.seq ?? "?") + (isNew === 1 ? " new" : " dup") + " ack " + (ackSeq ?? "?") });
return [fwd, ackMsg];
