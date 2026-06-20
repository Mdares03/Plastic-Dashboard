#pragma once
// MIS Control Tower — ESP32 wire protocol (plan §A/§B/§E).
//
// Envelope matches the cloud canonical shape (lib/contracts/v1.ts):
//   { schemaVersion, machineId, seq, tsDevice, type, payload }
// The Pi adapter unwraps it, dedupes on (machineId, seq), and feeds level+tsDevice
// into the existing Node-RED `function 1`. tsDevice is ABSOLUTE UTC ms.

#include <Arduino.h>
#include <ArduinoJson.h>
#include "OutboxStore.h"
#include "DeviceClock.h"

namespace Protocol {

static const char* SCHEMA_VERSION = "1.0";

// Edge message → topic mis/edge/<machineId>/cycle
inline size_t buildEdge(char* out, size_t cap, const char* machineId,
                        const EdgeRecord& rec, int64_t tsDeviceUtc, bool clockSynced) {
  JsonDocument doc;
  doc["schemaVersion"] = SCHEMA_VERSION;
  doc["machineId"] = machineId;
  doc["seq"] = rec.seq;
  doc["tsDevice"] = tsDeviceUtc;
  doc["type"] = "edge";
  JsonObject p = doc["payload"].to<JsonObject>();
  p["channel"] = rec.channel;
  p["level"] = rec.level;
  p["tDeviceMs"] = rec.tDeviceMs; // raw monotonic, for debugging
  p["clockSynced"] = clockSynced;
  return serializeJson(doc, out, cap);
}

// Liveness heartbeat → topic mis/edge/<machineId>/heartbeat (plan §D)
inline size_t buildHeartbeat(char* out, size_t cap, const char* machineId,
                             uint64_t seq, int64_t tsDeviceUtc, bool clockSynced,
                             size_t bufferDepth, int64_t uptimeMs, int rssi) {
  JsonDocument doc;
  doc["schemaVersion"] = SCHEMA_VERSION;
  doc["machineId"] = machineId;
  doc["seq"] = seq;
  doc["tsDevice"] = tsDeviceUtc;
  doc["type"] = "reader_heartbeat";
  JsonObject p = doc["payload"].to<JsonObject>();
  p["fw"] = CFG_FW_VERSION;
  p["clockSynced"] = clockSynced;
  p["bufferDepth"] = bufferDepth;
  p["uptimeMs"] = uptimeMs;
  p["rssi"] = rssi;
  return serializeJson(doc, out, cap);
}

// Time request → topic mis/edge/<machineId>/time/req (plan §E)
inline size_t buildTimeReq(char* out, size_t cap, const char* machineId,
                           int64_t reqDeviceMs) {
  JsonDocument doc;
  doc["machineId"] = machineId;
  doc["reqDeviceMs"] = reqDeviceMs;
  return serializeJson(doc, out, cap);
}

} // namespace Protocol
