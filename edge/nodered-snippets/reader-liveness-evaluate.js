// Edge split E4 (plan §D) — "Reader liveness: evaluate" function node.
// IN:  an inject node, every 5s (repeat). OUT: none (sets global readerOnline).
//
// Turns reader-heartbeat freshness into the readerOnline boolean that BOTH the
// Anomaly Detector (suppresses false stoppages when false) and the Online
// HeartBeat (reports DATA_LOSS to the cloud) read. Runs on a timer so the link
// is marked dead when heartbeats STOP, not only when a message arrives.
//
// STALE threshold = 3x the ESP32 heartbeat cadence (CFG_HEARTBEAT_MS=5s) = 15s.

const STALE_MS = 15000;
const lastSeen = Number(global.get("readerLastSeenMs") || 0);

// Until the first reader heartbeat ever arrives, leave readerOnline UNSET (null →
// "not a split machine / not reported"), so non-split machines never show DATA_LOSS.
if (lastSeen === 0) return null;

const online = (Date.now() - lastSeen) <= STALE_MS;
global.set("readerOnline", online);
node.status({ fill: online ? "green" : "red", shape: online ? "dot" : "ring",
              text: online ? "reader online" : "DATA_LOSS: reader dead" });
return null;
