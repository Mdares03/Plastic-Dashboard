// MIS Control Tower — ESP32 cabinet edge reader (plan §A/§B/§E).
//
// Dumb store-and-forward reader. Pipeline:
//   opto-isolated relay --> debounced edge --> NVS outbox (seq + flash buffer)
//     --> MQTT publish to the Pi (QoS handled by app-level ack) --> trim on ack.
// Plus a ~5s liveness heartbeat (DATA_LOSS detection on the Pi) and a periodic
// clock-sync exchange (ESP32 has no RTC). ALL cycle/business logic stays on the Pi.

#include <Arduino.h>
#include <WiFi.h>
#include <PubSubClient.h>
#include <Preferences.h>
#include <ArduinoJson.h>

#include "config.h"
#include "DeviceClock.h"
#include "OutboxStore.h"
#include "EdgeInput.h"
#include "Protocol.h"

static WiFiClient wifiClient;
static PubSubClient mqtt(wifiClient);
static DeviceClock clk;
static OutboxStore outbox;
static EdgeInput input;

static String gMachineId;
static String tEdge, tHeartbeat, tTimeReq, tAck, tTime;

static int64_t gLastHeartbeatMs = 0;
static int64_t gLastTimeReqMs = 0;
static int64_t gLastDrainMs = 0;             // last unacked re-drain (resubscribe-race guard)
static int64_t gPendingTimeReqDeviceMs = -1; // device ms of the in-flight time request
static char gBuf[512];

// ── Provisioning: NVS overrides compile-time defaults (README "Provisioning") ──
static String provisioned(const char* key, const char* fallback) {
  Preferences p;
  p.begin("misprov", true);
  String v = p.getString(key, fallback);
  p.end();
  return v;
}

static void buildTopics() {
  String base = "mis/edge/" + gMachineId;
  tEdge = base + "/cycle";
  tHeartbeat = base + "/heartbeat";
  tTimeReq = base + "/time/req";
  tAck = base + "/ack";
  tTime = base + "/time";
}

// ── Publish one buffered edge (offset applied NOW so a resync corrects it) ─────
static bool publishEdge(const EdgeRecord& rec) {
  if (!mqtt.connected()) return false;
  int64_t tsUtc = clk.toUtc(rec.tDeviceMs);
  size_t n = Protocol::buildEdge(gBuf, sizeof(gBuf), gMachineId.c_str(), rec, tsUtc,
                                 clk.synced());
  return mqtt.publish(tEdge.c_str(), (const uint8_t*)gBuf, n, false);
}

// Replay every unacked edge in order (after (re)connect AND on the CFG_REDRAIN_MS
// timer, so edges dropped in the broker-restart resubscribe race are retried
// instead of stalling). Duplicates are fine — the Pi dedupes on (machineId, seq).
static void drainOutbox() {
  for (size_t i = 0; i < outbox.depth(); i++) {
    if (!publishEdge(outbox.at(i))) break;
    delay(CFG_REPLAY_GAP_MS);
    mqtt.loop();
  }
  gLastDrainMs = clk.deviceMs();
}

static void sendHeartbeat() {
  if (!mqtt.connected()) return;
  size_t n = Protocol::buildHeartbeat(gBuf, sizeof(gBuf), gMachineId.c_str(),
                                      0, clk.nowUtc(), clk.synced(), outbox.depth(),
                                      clk.deviceMs(), WiFi.RSSI());
  mqtt.publish(tHeartbeat.c_str(), (const uint8_t*)gBuf, n, false);
}

static void sendTimeReq() {
  if (!mqtt.connected()) return;
  gPendingTimeReqDeviceMs = clk.deviceMs();
  size_t n = Protocol::buildTimeReq(gBuf, sizeof(gBuf), gMachineId.c_str(),
                                    gPendingTimeReqDeviceMs);
  mqtt.publish(tTimeReq.c_str(), (const uint8_t*)gBuf, n, false);
}

// ── MQTT inbound: acks (trim buffer) and time replies (set offset) ────────────
static void onMessage(char* topic, byte* payload, unsigned int len) {
  JsonDocument doc;
  if (deserializeJson(doc, payload, len)) return; // ignore malformed

  if (tAck.equals(topic)) {
    if (doc["ackSeq"].is<uint64_t>()) outbox.ackUpTo(doc["ackSeq"].as<uint64_t>());
    return;
  }
  if (tTime.equals(topic)) {
    // Pi reply: { reqDeviceMs, piUtcMs }. Match against our in-flight request.
    if (!doc["piUtcMs"].is<int64_t>()) return;
    int64_t reqDeviceMs = doc["reqDeviceMs"].is<int64_t>()
                              ? doc["reqDeviceMs"].as<int64_t>()
                              : gPendingTimeReqDeviceMs;
    if (reqDeviceMs < 0) return;
    clk.applyTimeReply(reqDeviceMs, doc["piUtcMs"].as<int64_t>(), clk.deviceMs());
    gPendingTimeReqDeviceMs = -1;
    return;
  }
}

static void ensureMqtt() {
  if (mqtt.connected()) return;
  String clientId = "mis-edge-" + gMachineId;
  if (mqtt.connect(clientId.c_str())) {
    mqtt.subscribe(tAck.c_str());
    mqtt.subscribe(tTime.c_str());
    sendTimeReq();   // resync immediately on connect (plan §E)
    drainOutbox();   // replay anything buffered during the outage
  }
}

void setup() {
  Serial.begin(115200);
  gMachineId = provisioned("machineId", CFG_MACHINE_ID);
  buildTopics();

  input.begin();
  outbox.begin();

  String ssid = provisioned("wifiSsid", CFG_WIFI_SSID);
  String pass = provisioned("wifiPass", CFG_WIFI_PASS);
  WiFi.mode(WIFI_STA);
  WiFi.begin(ssid.c_str(), pass.c_str());

  mqtt.setServer(provisioned("mqttHost", CFG_MQTT_HOST).c_str(), CFG_MQTT_PORT);
  mqtt.setBufferSize(512);
  mqtt.setCallback(onMessage);

  Serial.printf("MIS edge reader %s machine=%s buffered=%u\n", CFG_FW_VERSION,
                gMachineId.c_str(), (unsigned)outbox.depth());
}

void loop() {
  if (WiFi.status() == WL_CONNECTED) ensureMqtt();
  mqtt.loop();

  const int64_t now = clk.deviceMs();

  // 1) Edge: enqueue (persist) then publish. Buffer survives a power blip.
  uint8_t level;
  int64_t tEdgeMs;
  if (input.poll(now, level, tEdgeMs)) {
    EdgeRecord rec = outbox.enqueue(tEdgeMs, CFG_CHANNEL, level);
    publishEdge(rec); // ack will trim it; if offline it stays buffered for replay
  }

  // 2) Liveness heartbeat (DATA_LOSS detection on the Pi).
  if (now - gLastHeartbeatMs >= CFG_HEARTBEAT_MS) {
    gLastHeartbeatMs = now;
    sendHeartbeat();
  }

  // 3) Periodic clock resync (absorbs ESP32 drift).
  if (now - gLastTimeReqMs >= CFG_TIMESYNC_MS) {
    gLastTimeReqMs = now;
    sendTimeReq();
  }

  // 4) Re-drain unacked edges on a timer (not only on reconnect). Closes the
  //    broker-restart resubscribe-race window: if we reconnect and replay before
  //    the Pi re-subscribes, those QoS-0 edges are dropped and would otherwise sit
  //    unacked until the next disconnect. Retrying every CFG_REDRAIN_MS guarantees
  //    eventual delivery; the Pi dedupes replays on (machineId, seq).
  if (mqtt.connected() && outbox.depth() > 0 && now - gLastDrainMs >= CFG_REDRAIN_MS) {
    drainOutbox();
  }
}
