// Edge split E4 (plan §D) — "Reader liveness: record" function node.
// IN: mqtt-in on topic  mis/edge/+/heartbeat  (ESP32 reader_heartbeat)
// OUT: none (sets globals consumed by the evaluate timer + Online HeartBeat).
//
// Records the freshness + health of the wireless reader on every reader heartbeat.
// The "evaluate" timer turns this into the readerOnline boolean (it must go false
// when heartbeats STOP, which only a timer can detect).

let hb = msg.payload;
if (typeof hb === "string") { try { hb = JSON.parse(hb); } catch (e) { return null; } }
if (!hb || typeof hb !== "object") return null;
const p = hb.payload || {};

global.set("readerLastSeenMs", Date.now());
if (typeof p.clockSynced === "boolean") global.set("readerClockSynced", p.clockSynced);
if (typeof p.bufferDepth === "number") global.set("readerBufferDepth", p.bufferDepth);
return null;
