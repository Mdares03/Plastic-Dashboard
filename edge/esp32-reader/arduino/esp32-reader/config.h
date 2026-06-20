#pragma once
// MIS Control Tower — ESP32 reader configuration (plan §A/§B).
//
// Bench provisioning: edit the values below, or set them at runtime in NVS (see
// README "Provisioning"). NVS values, when present, override these compile-time
// defaults so one firmware image can be reused across machines.

// ── Identity ────────────────────────────────────────────────────────────────
// The machine this reader is wired to. MUST match the Pi's paired machineId so
// the envelope is congruent end-to-end (cloud dedupes on (machineId, seq)).
#define CFG_MACHINE_ID "00000000-0000-0000-0000-000000000000"
#define CFG_FW_VERSION "1.0.0"

// ── Pi-hosted WiFi AP (plan §B) ─────────────────────────────────────────────
// The Pi runs the AP + Mosquitto; the ESP32 joins it. Keeps the link off the
// factory network entirely.
#define CFG_WIFI_SSID "mis-edge-ap"
#define CFG_WIFI_PASS "change-me-on-bench"
#define CFG_MQTT_HOST "192.168.4.1" // Pi AP gateway address (hostapd default)
#define CFG_MQTT_PORT 1883

// ── Input (plan §A) ─────────────────────────────────────────────────────────
// GPIO fed by the OPTO-ISOLATED cycle relay (PC817 / isolated DI). NEVER 24V direct.
// Mirrors the Pi's old rpi-gpio pin-17 reader: emit on every debounced level change.
#define CFG_INPUT_PIN 4
#define CFG_INPUT_ACTIVE_HIGH 1     // 1 if relay-closed drives the GPIO high
#define CFG_DEBOUNCE_MS 25          // matches the old rpi-gpio debounce
#define CFG_CHANNEL 0               // single signal now; payload carries it for multi later

// ── Timing / intervals (plan §A/§E) ─────────────────────────────────────────
#define CFG_HEARTBEAT_MS 5000       // liveness cadence (lets the Pi detect DATA_LOSS)
#define CFG_TIMESYNC_MS 60000       // clock resync cadence (ESP32 has no RTC)
#define CFG_TIMESYNC_STALE_MS 180000 // offset considered stale (clockSynced=false) after this
#define CFG_REPLAY_GAP_MS 40        // spacing between replayed buffered edges on reconnect
#define CFG_REDRAIN_MS 5000         // re-drain unacked edges on this cadence even while connected;
                                    // closes the broker-restart resubscribe-race window (edges
                                    // replayed before the Pi re-subscribes are QoS-0-dropped and
                                    // would otherwise stall until the next disconnect). Idempotent —
                                    // the Pi dedupes on (machineId, seq).

// ── Store-and-forward buffer (plan §A) ──────────────────────────────────────
// Unacked edges live in NVS so they survive a 24V power blip. Capacity bounds
// the worst-case outage we can buffer (at injection-cycle rates, 256 ≈ hours).
#define CFG_BUFFER_CAPACITY 256
