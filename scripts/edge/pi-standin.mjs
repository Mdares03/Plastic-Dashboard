// MIS Control Tower — local "Pi stand-in" for bench-testing the REAL ESP32 reader.
//
// Runs an MQTT broker on this computer AND plays the part of the Pi: it ACKs edges
// (contiguous high-water, exactly like the Pi's edge_inbound/edge_ack_state) and
// answers the ESP32's clock-sync requests. That makes a real ESP32 behave end-to-end
// just as it would against the Pi — edges get acked + trimmed, the clock syncs — but
// everything lands HERE on your laptop so you can watch the real wire traffic before
// pointing the reader at the actual Pi.
//
// One-time setup:   npm install aedes
// Run:              node scripts/edge/pi-standin.mjs            (listens on 0.0.0.0:1883)
//   options:        --port 1883   --verbose   (--verbose also logs raw heartbeats)
//
// Then set the ESP32 config.h:  CFG_MQTT_HOST = <this computer's LAN IP>, CFG_MQTT_PORT 1883.
// Topics handled (must match edge/esp32-reader/src/Protocol.h):
//   in  mis/edge/<id>/cycle      type=edge             {channel,level,tDeviceMs,clockSynced}
//   in  mis/edge/<id>/heartbeat  type=reader_heartbeat {fw,clockSynced,bufferDepth,uptimeMs,rssi}
//   in  mis/edge/<id>/time/req                          {machineId,reqDeviceMs}
//   out mis/edge/<id>/ack                               {ackSeq}     (trim <= ackSeq)
//   out mis/edge/<id>/time                              {reqDeviceMs,piUtcMs}

import { createServer } from "node:net";

const args = process.argv.slice(2);
const getOpt = (k, d) => {
  const i = args.indexOf(k);
  return i >= 0 && args[i + 1] ? args[i + 1] : d;
};
const PORT = parseInt(getOpt("--port", "1883"), 10);
const VERBOSE = args.includes("--verbose");

let Aedes;
try {
  ({ Aedes } = await import("aedes"));
} catch {
  console.error(
    "\n  Missing dependency 'aedes'. Install it once with:\n\n    npm install aedes\n",
  );
  process.exit(1);
}

// aedes v0.51+ removed the default export; brokers are created via the async factory.
const aedes = await Aedes.createBroker();
const server = createServer(aedes.handle);

// Per-machine contiguous-ack tracking — mirrors the Pi's edge_inbound dedup +
// edge_ack_state.last_contiguous_seq. We ack the highest seq for which every seq
// below it has also been seen, so out-of-order / replayed edges are handled exactly
// like production.
const state = new Map(); // machineId -> { seen:Set<number>, contiguous:number }

function machineState(id) {
  let s = state.get(id);
  if (!s) {
    s = { seen: new Set(), contiguous: 0 };
    state.set(id, s);
  }
  return s;
}

function recordSeqAndAck(id, seq) {
  const s = machineState(id);
  const isNew = !s.seen.has(seq);
  s.seen.add(seq);
  // advance the contiguous high-water
  while (s.seen.has(s.contiguous + 1)) s.contiguous++;
  return { isNew, ack: s.contiguous };
}

const ts = () => new Date().toISOString().slice(11, 23);
const log = (...a) => console.log(ts(), ...a);

function publish(topic, obj) {
  aedes.publish({ topic, payload: Buffer.from(JSON.stringify(obj)), qos: 0, retain: false });
}

aedes.on("client", (c) => log("client CONNECT  ", c?.id));
aedes.on("clientDisconnect", (c) => log("client DISCONNECT", c?.id));

aedes.on("publish", (packet, client) => {
  if (!client) return; // skip our own broker-originated messages (acks/time replies)
  const topic = packet.topic || "";
  const m = topic.match(/^mis\/edge\/([^/]+)\/(cycle|heartbeat|time\/req)$/);
  if (!m) {
    if (VERBOSE) log("(unhandled topic)", topic);
    return;
  }
  const [, id, kind] = m;
  let env;
  try {
    env = JSON.parse(packet.payload.toString());
  } catch {
    log("BAD JSON on", topic);
    return;
  }

  if (kind === "cycle") {
    const seq = Number(env.seq);
    const p = env.payload || {};
    const { isNew, ack } = recordSeqAndAck(id, seq);
    const dev = env.tsDevice ? new Date(Number(env.tsDevice)).toISOString().slice(11, 23) : "?";
    log(
      `EDGE   seq=${seq}${isNew ? "" : " (dup)"} level=${p.level} ch=${p.channel}`,
      `clockSynced=${p.clockSynced} tsDevice=${dev} -> ack=${ack}`,
    );
    publish(`mis/edge/${id}/ack`, { ackSeq: ack });
  } else if (kind === "heartbeat") {
    const p = env.payload || {};
    log(
      `HB     fw=${p.fw} clockSynced=${p.clockSynced} bufferDepth=${p.bufferDepth}`,
      `rssi=${p.rssi} uptimeMs=${p.uptimeMs}`,
    );
    if (VERBOSE) log("   raw:", JSON.stringify(env));
  } else if (kind === "time/req") {
    const piUtcMs = Date.now();
    publish(`mis/edge/${id}/time`, { reqDeviceMs: env.reqDeviceMs, piUtcMs });
    log(`TIMEREQ reqDeviceMs=${env.reqDeviceMs} -> piUtcMs=${piUtcMs} (clock-sync reply sent)`);
  }
});

server.listen(PORT, "0.0.0.0", () => {
  log(`Pi stand-in MQTT broker listening on 0.0.0.0:${PORT}`);
  log("Point the ESP32 at this computer's LAN IP. Ctrl-C to stop.");
});
