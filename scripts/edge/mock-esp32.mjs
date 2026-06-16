// Edge split E6 (plan §C) — software ESP32 reader simulator.
//
// Impersonates the dumb store-and-forward ESP32 cabinet reader so the whole Pi
// receive pipeline (MQTT ingest → dedup/ack proc → outbox → cloud → dashboard
// DATA_LOSS) can be validated with NO hardware powered on. It byte-matches the
// firmware wire protocol (edge/esp32-reader/src/Protocol.h; cloud canonical shape
// in lib/contracts/v1.ts) and reproduces the firmware's behaviour:
//   • monotonic device clock + Pi-learned offset, applied at PUBLISH time so a
//     resync retroactively corrects still-buffered edges (DeviceClock.h);
//   • per-device seq that NEVER resets, persisted to a seq-file (= NVS);
//   • unacked edges buffered (drop-oldest at capacity) and replayed oldest-first
//     on (re)connect; the Pi acks a high-water seq and we trim ≤ ackSeq
//     (OutboxStore.h);
//   • ~5 s liveness heartbeat + periodic clock-sync request (main.cpp).
//
// IMPORTANT (plan §E): the simulator publishes as the REAL paired machine, so the
// Pi's `rpi-gpio in` pin-17 MUST be disabled during sim runs or `function 1` gets
// double-fed. Rollback = re-enable that node.
//
// Usage:
//   node scripts/edge/mock-esp32.mjs --machine-id <uuid> [flags]
// Scenarios (software subset of the §9 bench gate):
//   normal count parity (§9.2):   --cycle-ms 4000
//   broker-kill replay (§9.3):    --cycle-ms 4000 --seq-file ./sim.seq   (then kill/restart Mosquitto)
//   power-blip replay (§9.4):     same + Ctrl-C and relaunch (buffer survives via --seq-file)
//   DATA_LOSS (§9.6):             --cycle-ms 4000 --stop-heartbeat-after 20
//   one stoppage incident (§9.7): --cycle-ms 4000 --stoppage --stoppage-after 20

import mqtt from "mqtt";
import fs from "node:fs";

// ── tiny arg parser ───────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      out[key] = true; // boolean flag
    } else {
      out[key] = next;
      i++;
    }
  }
  return out;
}
const args = parseArgs(process.argv.slice(2));

const FW_VERSION = "1.0.0"; // CFG_FW_VERSION
const SCHEMA_VERSION = "1.0"; // Protocol::SCHEMA_VERSION
const TIMESYNC_STALE_MS = 180000; // CFG_TIMESYNC_STALE_MS

const cfg = {
  host: args.host || "127.0.0.1",
  port: Number(args.port || 1883),
  machineId: args["machine-id"],
  channel: Number(args.channel ?? 0),
  heartbeatMs: Number(args["heartbeat-ms"] || 5000), // CFG_HEARTBEAT_MS
  timesyncMs: Number(args["timesync-ms"] || 60000), // CFG_TIMESYNC_MS
  redrainMs: Number(args["redrain-ms"] || 5000), // CFG_REDRAIN_MS — retry unacked even while connected
  cycleMs: args["cycle-ms"] !== undefined ? Number(args["cycle-ms"]) : null,
  pulseMs: args["pulse-ms"] !== undefined ? Number(args["pulse-ms"]) : null,
  bufferCapacity: Number(args["buffer-capacity"] || 256), // CFG_BUFFER_CAPACITY
  seqFile: args["seq-file"] || null,
  forceSeq: args.seq !== undefined ? Number(args.seq) : null,
  stopHeartbeatAfter: args["stop-heartbeat-after"] !== undefined ? Number(args["stop-heartbeat-after"]) : null,
  stoppage: !!args.stoppage,
  stoppageAfter: Number(args["stoppage-after"] || 20),
  durationS: args.duration !== undefined ? Number(args.duration) : null,
  verbose: !!args.verbose,
};

if (!cfg.machineId || typeof cfg.machineId !== "string") {
  console.error("ERROR: --machine-id <uuid> is required (the REAL paired machineId).");
  process.exit(1);
}
if (cfg.cycleMs !== null && cfg.pulseMs === null) cfg.pulseMs = Math.max(20, Math.floor(cfg.cycleMs / 2));

const log = (...a) => console.log(new Date().toISOString(), ...a);
const vlog = (...a) => { if (cfg.verbose) log(...a); };

// ── topics (mirror main.cpp buildTopics) ────────────────────────────────────────
const base = `mis/edge/${cfg.machineId}`;
const T = {
  edge: `${base}/cycle`,
  heartbeat: `${base}/heartbeat`,
  timeReq: `${base}/time/req`,
  ack: `${base}/ack`,
  time: `${base}/time`,
};

// ── monotonic device clock + Pi-learned offset (DeviceClock.h) ──────────────────
const bootHr = process.hrtime.bigint();
const deviceMs = () => Number((process.hrtime.bigint() - bootHr) / 1000000n);
const clock = {
  offsetMs: 0,
  haveOffset: false,
  lastSyncDeviceMs: 0,
  toUtc(dMs) { return dMs + this.offsetMs; },
  nowUtc() { return this.toUtc(deviceMs()); },
  synced() { return this.haveOffset && (deviceMs() - this.lastSyncDeviceMs) <= TIMESYNC_STALE_MS; },
  applyTimeReply(reqDeviceMs, piUtcMs, recvDeviceMs) {
    const rtt = recvDeviceMs - reqDeviceMs;
    this.offsetMs = piUtcMs + Math.trunc(rtt / 2) - recvDeviceMs;
    this.lastSyncDeviceMs = recvDeviceMs;
    this.haveOffset = true;
    log(`clock synced: offset=${this.offsetMs}ms rtt=${rtt}ms`);
  },
};

// ── store-and-forward outbox (OutboxStore.h), persisted to seq-file (= NVS) ─────
const outbox = {
  seqNext: 1,
  buf: [], // [{ seq, tDeviceMs, channel, level }]
  load() {
    if (cfg.seqFile && fs.existsSync(cfg.seqFile)) {
      try {
        const s = JSON.parse(fs.readFileSync(cfg.seqFile, "utf8"));
        if (Number.isFinite(s.seqNext)) this.seqNext = s.seqNext;
        if (Array.isArray(s.buf)) this.buf = s.buf.slice(-cfg.bufferCapacity);
        log(`loaded seq-file: seqNext=${this.seqNext} buffered=${this.buf.length}`);
      } catch (e) {
        log(`WARN: could not parse seq-file (${e.message}); starting fresh`);
      }
    }
    if (cfg.forceSeq !== null && Number.isFinite(cfg.forceSeq)) {
      this.seqNext = cfg.forceSeq;
      log(`--seq override: seqNext=${this.seqNext}`);
    }
  },
  persist() {
    if (!cfg.seqFile) return;
    fs.writeFileSync(cfg.seqFile, JSON.stringify({ seqNext: this.seqNext, buf: this.buf }));
  },
  enqueue(tDeviceMs, channel, level) {
    const rec = { seq: this.seqNext, tDeviceMs, channel, level };
    this.seqNext++;
    if (this.buf.length >= cfg.bufferCapacity) this.buf.shift(); // drop oldest → genuine gap
    this.buf.push(rec);
    this.persist();
    return rec;
  },
  ackUpTo(ackSeq) {
    const before = this.buf.length;
    this.buf = this.buf.filter((r) => r.seq > ackSeq);
    if (this.buf.length !== before) { this.persist(); vlog(`ack ${ackSeq}: trimmed ${before - this.buf.length}, depth=${this.buf.length}`); }
  },
  depth() { return this.buf.length; },
};
outbox.load();

// ── envelope builders (byte-match Protocol.h key order) ─────────────────────────
function buildEdge(rec) {
  return JSON.stringify({
    schemaVersion: SCHEMA_VERSION,
    machineId: cfg.machineId,
    seq: rec.seq,
    tsDevice: clock.toUtc(rec.tDeviceMs), // offset applied NOW (resync corrects buffered)
    type: "edge",
    payload: { channel: rec.channel, level: rec.level, tDeviceMs: rec.tDeviceMs, clockSynced: clock.synced() },
  });
}
function buildHeartbeat() {
  return JSON.stringify({
    schemaVersion: SCHEMA_VERSION,
    machineId: cfg.machineId,
    seq: 0,
    tsDevice: clock.nowUtc(),
    type: "reader_heartbeat",
    payload: { fw: FW_VERSION, clockSynced: clock.synced(), bufferDepth: outbox.depth(), uptimeMs: deviceMs(), rssi: -55 },
  });
}
function buildTimeReq(reqDeviceMs) {
  return JSON.stringify({ machineId: cfg.machineId, reqDeviceMs }); // no schemaVersion (matches buildTimeReq)
}

// ── MQTT client + reader state machine ──────────────────────────────────────────
const client = mqtt.connect(`mqtt://${cfg.host}:${cfg.port}`, {
  clientId: `mis-edge-${cfg.machineId}`,
  reconnectPeriod: 1000,
  clean: true,
});

let connected = false;
let pendingTimeReqDeviceMs = -1;
let readerDead = false; // §9.6 — the whole reader goes silent
let cyclesStopped = false; // §9.7 — machine stopped, reader alive
let cycleCount = 0;
let edgeCount = 0;
let level = 0; // current relay level (toggles 0/1 per edge)
const startWallMs = Date.now();

function publishEdge(rec) {
  if (!connected) return false;
  client.publish(T.edge, buildEdge(rec), { qos: 1 });
  return true;
}

// Replay every unacked edge in order — after (re)connect AND on the redrain timer
// (drainOutbox in main.cpp). The timer retries edges dropped in the broker-restart
// resubscribe race instead of letting them stall until the next disconnect.
function drainOutbox() {
  if (!connected || outbox.depth() === 0) return;
  log(`draining outbox: replaying ${outbox.depth()} unacked edge(s)`);
  for (const rec of outbox.buf) publishEdge(rec);
}

function sendHeartbeat() {
  if (!connected || readerDead) return;
  client.publish(T.heartbeat, buildHeartbeat(), { qos: 0 });
  vlog(`heartbeat: depth=${outbox.depth()} synced=${clock.synced()}`);
}

function sendTimeReq() {
  if (!connected || readerDead) return;
  pendingTimeReqDeviceMs = deviceMs();
  client.publish(T.timeReq, buildTimeReq(pendingTimeReqDeviceMs), { qos: 0 });
}

// One physical edge: enqueue (persist) then publish; buffered until acked.
function emitEdge(lvl) {
  const rec = outbox.enqueue(deviceMs(), cfg.channel, lvl);
  edgeCount++;
  publishEdge(rec); // ack trims it; offline → stays buffered for replay
  vlog(`edge seq=${rec.seq} level=${lvl} ${connected ? "(sent)" : "(buffered, offline)"}`);
}

// A cycle = rising + falling edge (emit-on-change, like rpi-gpio pin-17).
function runCycle() {
  if (readerDead || cyclesStopped) return;
  level = 1;
  emitEdge(1);
  setTimeout(() => {
    if (readerDead || cyclesStopped) return;
    level = 0;
    emitEdge(0);
    cycleCount++;
  }, cfg.pulseMs);
}

client.on("connect", () => {
  connected = true;
  log(`connected to mqtt://${cfg.host}:${cfg.port} as machine=${cfg.machineId}`);
  client.subscribe([T.ack, T.time], { qos: 1 }, (err) => { if (err) log("subscribe error:", err.message); });
  sendTimeReq(); // resync immediately on connect (plan §E)
  drainOutbox(); // replay anything buffered during the outage
});

client.on("reconnect", () => vlog("reconnecting…"));
client.on("offline", () => { connected = false; log("offline — buffering edges for replay"); });
client.on("error", (e) => log("mqtt error:", e.message));

client.on("message", (topic, payload) => {
  let doc;
  try { doc = JSON.parse(payload.toString()); } catch { return; } // ignore malformed
  if (topic === T.ack) {
    if (Number.isFinite(Number(doc.ackSeq))) outbox.ackUpTo(Number(doc.ackSeq));
    return;
  }
  if (topic === T.time) {
    if (!Number.isFinite(Number(doc.piUtcMs))) return;
    const reqDeviceMs = Number.isFinite(Number(doc.reqDeviceMs)) ? Number(doc.reqDeviceMs) : pendingTimeReqDeviceMs;
    if (reqDeviceMs < 0) return;
    clock.applyTimeReply(reqDeviceMs, Number(doc.piUtcMs), deviceMs());
    pendingTimeReqDeviceMs = -1;
  }
});

// ── timers ──────────────────────────────────────────────────────────────────────
const timers = [];
timers.push(setInterval(sendHeartbeat, cfg.heartbeatMs));
timers.push(setInterval(sendTimeReq, cfg.timesyncMs));
timers.push(setInterval(drainOutbox, cfg.redrainMs)); // CFG_REDRAIN_MS — retry unacked (resubscribe-race guard)
if (cfg.cycleMs !== null) timers.push(setInterval(runCycle, cfg.cycleMs));

// scenario triggers
if (cfg.stopHeartbeatAfter !== null) {
  setTimeout(() => {
    readerDead = true;
    log(`*** §9.6: reader going SILENT after ${cfg.stopHeartbeatAfter}s — expect DATA_LOSS (~15s), no phantom downtime ***`);
  }, cfg.stopHeartbeatAfter * 1000);
}
if (cfg.stoppage) {
  setTimeout(() => {
    cyclesStopped = true;
    log(`*** §9.7: MACHINE STOPPED after ${cfg.stoppageAfter}s (reader still alive) — expect exactly one AlertIncident ***`);
  }, cfg.stoppageAfter * 1000);
}
if (cfg.durationS !== null) {
  setTimeout(() => { log(`duration ${cfg.durationS}s reached — exiting`); shutdown(0); }, cfg.durationS * 1000);
}

function shutdown(code = 0) {
  log(`shutting down: cycles=${cycleCount} edges=${edgeCount} buffered(unacked)=${outbox.depth()} ran=${Math.round((Date.now() - startWallMs) / 1000)}s`);
  for (const t of timers) clearInterval(t);
  client.end(true, {}, () => process.exit(code));
  setTimeout(() => process.exit(code), 1500).unref();
}
process.on("SIGINT", () => { log("SIGINT"); shutdown(0); });
process.on("SIGTERM", () => { log("SIGTERM"); shutdown(0); });

log(`mock-esp32 starting: machine=${cfg.machineId} cycle=${cfg.cycleMs ?? "off"}ms pulse=${cfg.pulseMs ?? "-"}ms hb=${cfg.heartbeatMs}ms timesync=${cfg.timesyncMs}ms seqNext=${outbox.seqNext}${cfg.seqFile ? " seqFile=" + cfg.seqFile : ""}`);
