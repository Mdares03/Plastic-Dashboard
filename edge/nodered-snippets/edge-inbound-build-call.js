// Edge split E2 (plan §C) — "Edge Inbound: build CALL" function node.
// IN:  mqtt-in on topic  mis/edge/+/cycle  (ESP32 edge envelope)
// OUT: a mysql node (config "Edge Outbox", fc9634aabefee16b) running edge_inbound_ingest
//
// Parses the ESP32 envelope and prepares the atomic dedup/ack proc call. Carries
// level/tsDevice forward on msg for the ack+forward node.

let env = msg.payload;
if (typeof env === "string") {
    try { env = JSON.parse(env); } catch (e) { node.warn("edge inbound: bad JSON"); return null; }
}
if (!env || typeof env !== "object") { node.warn("edge inbound: empty"); return null; }

const machineId = env.machineId;
const seq = Number(env.seq);
const p = env.payload || {};
const channel = Number(p.channel ?? 0);
const level = Number(p.level);
const tsDevice = Number(env.tsDevice ?? p.tsDevice);   // absolute UTC ms from the ESP32
const clockSynced = p.clockSynced === true ? 1 : 0;

if (!machineId || !Number.isFinite(seq) || (level !== 0 && level !== 1) || !Number.isFinite(tsDevice)) {
    node.warn("edge inbound: invalid envelope " + JSON.stringify(env).slice(0, 120));
    return null;
}

// Stash for the ack+forward node (mysql result won't echo these).
msg._edge = { machineId, seq, channel, level, tsDevice, clockSynced };

msg.topic = "CALL edge_inbound_ingest(?, ?, ?, ?, ?, ?);";
msg.payload = [machineId, seq, channel, level, tsDevice, clockSynced];
return msg;
