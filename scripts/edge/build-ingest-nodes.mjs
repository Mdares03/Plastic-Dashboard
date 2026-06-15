// Edge split E6 (plan §B) — build the importable, pre-wired ingest nodes.
//
// Emits  edge/nodered-import/edge-ingest.json  (a standalone Node-RED import
// containing the LOCAL mqtt-broker config + the ingest/clock/liveness nodes)
// AND merges the exact same nodes into edge/flows.json so a single full-flow
// re-import is already fully wired.
//
// Function-node bodies are taken VERBATIM from edge/nodered-snippets/*.js.
// Node IDs are deterministic (sha1 of a stable label) so re-running is
// idempotent: existing copies are replaced in place, never duplicated.
//
// Usage:  node scripts/edge/build-ingest-nodes.mjs

import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const FLOWS = path.join(ROOT, "edge", "flows.json");
const SNIP = path.join(ROOT, "edge", "nodered-snippets");
const IMPORT_DIR = path.join(ROOT, "edge", "nodered-import");
const IMPORT_FILE = path.join(IMPORT_DIR, "edge-ingest.json");

// --- stable anchors from the live canonical (plan VERIFIED FACTS) ---
const TAB = "05d4cb231221b842";            // tab "Flow 2.1" (function 1 lives here)
const FUNCTION_1 = "ce36a3271d9df8ae";     // existing dedupe node — ack+forward out1 → here
const EDGE_DB = "fc9634aabefee16b";        // MySQLdatabase config "Edge Outbox" (reused for CALL)

// deterministic 16-hex id from a label (Node-RED node-id shape)
const id = (label) =>
  crypto.createHash("sha1").update("edge-ingest:" + label).digest("hex").slice(0, 16);

const ID = {
  broker: id("local-mqtt-broker"),
  cycleIn: id("mqtt-in-cycle"),
  buildCall: id("fn-build-call"),
  dedup: id("mysql-dedup-store"),
  ackFwd: id("fn-ack-forward"),
  ackOut: id("mqtt-out-ack"),
  timeReqIn: id("mqtt-in-time-req"),
  clockFn: id("fn-clock-responder"),
  timeOut: id("mqtt-out-time"),
  heartbeatIn: id("mqtt-in-heartbeat"),
  readerRecord: id("fn-reader-record"),
  livenessTick: id("inject-liveness-5s"),
  readerEval: id("fn-reader-evaluate"),
};

const body = (file) => fs.readFileSync(path.join(SNIP, file), "utf8").replace(/\s+$/, "") + "\n";

// --- the LOCAL Mosquitto broker config (NOT the cloud EMQX) ---
const broker = {
  id: ID.broker,
  type: "mqtt-broker",
  name: "Edge Local Mosquitto",
  broker: "127.0.0.1",
  port: "1883",
  clientid: "",
  autoConnect: true,
  usetls: false,
  protocolVersion: "4",
  keepalive: "60",
  cleansession: true,
  autoUnsubscribe: true,
  birthTopic: "",
  birthQos: "0",
  birthPayload: "",
  birthMsg: {},
  closeTopic: "",
  closeQos: "0",
  closePayload: "",
  closeMsg: {},
  willTopic: "",
  willQos: "0",
  willPayload: "",
  willMsg: {},
  userProps: "",
  sessionExpiry: "",
};

const mqttIn = (nid, name, topic, x, y, wires, { qos = "1" } = {}) => ({
  id: nid, type: "mqtt in", z: TAB, name, topic, qos, datatype: "json",
  broker: ID.broker, nl: false, rap: true, rh: 0, inputs: 0, x, y, wires: [wires],
});

const mqttOut = (nid, name, x, y, { qos = "1" } = {}) => ({
  id: nid, type: "mqtt out", z: TAB, name, topic: "", qos, retain: "",
  respTopic: "", contentType: "", userProps: "", correl: "", expiry: "",
  broker: ID.broker, x, y, wires: [],
});

const fn = (nid, name, file, x, y, wires, { outputs = 1 } = {}) => ({
  id: nid, type: "function", z: TAB, name, func: body(file),
  outputs, timeout: 0, noerr: 0, initialize: "", finalize: "", libs: [],
  x, y, wires,
});

const mysqlNode = (nid, name, x, y, wires) => ({
  id: nid, type: "mysql", z: TAB, mydb: EDGE_DB, name, x, y, wires: [wires],
});

// --- the four chains (plan §B) ---
const nodes = [
  // 1) cycle ingest → dedup/ack → forward into function 1 + ack back to reader
  mqttIn(ID.cycleIn, "mqtt in: edge cycle", "mis/edge/+/cycle", 160, 1440, [ID.buildCall]),
  fn(ID.buildCall, "Edge Inbound: build CALL", "edge-inbound-build-call.js", 400, 1440, [[ID.dedup]]),
  mysqlNode(ID.dedup, "Edge Inbound: dedup store", 680, 1440, [ID.ackFwd]),
  fn(ID.ackFwd, "Edge Inbound: ack + forward", "edge-inbound-ack-forward.js", 940, 1440,
    [[FUNCTION_1], [ID.ackOut]], { outputs: 2 }),
  mqttOut(ID.ackOut, "mqtt out: ack", 1220, 1480),

  // 2) time-sync responder
  mqttIn(ID.timeReqIn, "mqtt in: edge time/req", "mis/edge/+/time/req", 160, 1540, [ID.clockFn], { qos: "0" }),
  fn(ID.clockFn, "Clock responder", "clock-responder.js", 440, 1540, [[ID.timeOut]]),
  mqttOut(ID.timeOut, "mqtt out: time", 700, 1540, { qos: "0" }),

  // 3) reader heartbeat → record freshness/health globals
  mqttIn(ID.heartbeatIn, "mqtt in: edge heartbeat", "mis/edge/+/heartbeat", 160, 1640, [ID.readerRecord], { qos: "0" }),
  fn(ID.readerRecord, "Reader liveness: record", "reader-liveness-record.js", 440, 1640, [[]]),

  // 4) 5s timer → evaluate freshness → set global readerOnline (DATA_LOSS detection)
  {
    id: ID.livenessTick, type: "inject", z: TAB, name: "every 5s",
    props: [{ p: "payload" }], repeat: "5", crontab: "", once: false, onceDelay: 0.1,
    topic: "", payload: "", payloadType: "date", x: 160, y: 1740, wires: [[ID.readerEval]],
  },
  fn(ID.readerEval, "Reader liveness: evaluate", "reader-liveness-evaluate.js", 440, 1740, [[]]),
];

const all = [broker, ...nodes];
const newIds = new Set(all.map((n) => n.id));

// --- write the standalone importable subset ---
fs.mkdirSync(IMPORT_DIR, { recursive: true });
fs.writeFileSync(IMPORT_FILE, JSON.stringify(all, null, 4) + "\n");

// --- merge into the canonical full flow (idempotent: drop prior copies, re-append) ---
const flow = JSON.parse(fs.readFileSync(FLOWS, "utf8"));
const before = flow.length;
const kept = flow.filter((n) => !newIds.has(n.id));
const removed = before - kept.length;
const merged = [...kept, ...all];
fs.writeFileSync(FLOWS, JSON.stringify(merged, null, 4) + "\n");

console.log(`Wrote ${path.relative(ROOT, IMPORT_FILE)} (${all.length} nodes: 1 broker config + ${nodes.length} flow nodes)`);
console.log(`Merged into ${path.relative(ROOT, FLOWS)}: ${before} → ${merged.length} nodes (replaced ${removed} prior copies)`);
console.log("New node ids:");
for (const [k, v] of Object.entries(ID)) console.log(`  ${v}  ${k}`);
