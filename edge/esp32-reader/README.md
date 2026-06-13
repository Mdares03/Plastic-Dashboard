# ESP32 cabinet edge reader

A **dumb, store-and-forward** reader (plan §A). It timestamps the machine's cycle
relay transitions at the electrical cabinet and ships them to the Pi over MQTT. It
holds **no cycle/business logic** — the Pi keeps all of that. See
`/home/mdares/.claude/plans/composed-wandering-ember.md` for the full architecture.

## What it does

```
[24V cycle relay] --opto(PC817)--> GPIO --> debounce(25ms) --> NVS outbox (seq + flash buffer)
   --> MQTT publish to Pi --> trimmed when the Pi acks the seq
   + every 5s: liveness heartbeat (lets the Pi detect DATA_LOSS, plan §D)
   + every 60s: clock-sync exchange with the Pi (ESP32 has no RTC, plan §E)
```

- **Reproduces the old `rpi-gpio` stream**: emits on every confirmed level change
  (0→1 and 1→0), debounced ~25 ms, so the Pi's `function 1` → `Machine cycles` →
  `Anomaly Detector` path is unchanged.
- **Timestamps the physical edge** on a monotonic clock and converts to absolute
  UTC via the Pi-learned offset (`tsDevice`). Never uses arrival time.
- **Survives a 24V power blip**: seq + unacked edges live in NVS flash and replay
  from the oldest unacked on reconnect. The Pi dedupes on `(machineId, seq)`.

## Hardware (plan §A, hard reqs)

- ESP32 dev board (esp32dev / WROOM).
- **Opto-isolation on the input — mandatory.** ESP32 GPIO is 3.3V, NOT 24V
  tolerant. PC817 or an isolated DI module between the 24V relay and `CFG_INPUT_PIN`.
  24V direct = dead ESP32.
- 24V→5V industrial buck for ESP32 power at the cabinet.
- If the opto/DI output is open-collector, set the matching pull in `EdgeInput::begin`
  (`INPUT_PULLUP`/`INPUT_PULLDOWN`) and `CFG_INPUT_ACTIVE_HIGH` accordingly.

## Configure

Edit `src/config.h` for the bench (machineId, Pi AP SSID/pass, broker IP, input pin,
active-high). The **machineId MUST match the Pi's paired machine** so the envelope
is congruent end-to-end.

### Provisioning (optional, NVS overrides config.h)

So one image works across machines, runtime NVS values in namespace `misprov`
override the compile-time defaults: keys `machineId`, `wifiSsid`, `wifiPass`,
`mqttHost`. Set them with any NVS tool or a small provisioning sketch.

## Build / flash

```
pio run -t upload          # build + flash
pio device monitor         # serial @115200
```

## Wire protocol (matches lib/contracts/v1.ts envelope)

All ESP32→Pi messages: `{ schemaVersion, machineId, seq, tsDevice, type, payload }`.

| Topic | Dir | type | payload |
|---|---|---|---|
| `mis/edge/<id>/cycle` | →Pi | `edge` | `{channel, level, tDeviceMs, clockSynced}` |
| `mis/edge/<id>/heartbeat` | →Pi | `reader_heartbeat` | `{fw, clockSynced, bufferDepth, uptimeMs, rssi}` |
| `mis/edge/<id>/time/req` | →Pi | — | `{machineId, reqDeviceMs}` |
| `mis/edge/<id>/ack` | ←Pi | — | `{ackSeq}` (trim ≤ ackSeq) |
| `mis/edge/<id>/time` | ←Pi | — | `{reqDeviceMs, piUtcMs}` |

`tsDevice` is **absolute UTC ms** (raw device ms + Pi offset). The offset is applied
at publish, so a clock resync retroactively corrects still-buffered edges. Edge `seq`
is the per-device monotonic counter (persisted); heartbeats carry `seq:0` (liveness,
not deduped data).

## Notes / limits

- **NVS wear**: seq is a tiny write per edge; the unacked buffer blob is rewritten on
  change. At injection-cycle rates this is fine; if edge rate climbs, move the buffer
  to FRAM (plan risk note). `CFG_BUFFER_CAPACITY` (256) bounds the buffered outage.
- **Transport is swappable**: if the Pi-AP WiFi link proves flaky in-plant, the
  protocol above is reusable over ESP-NOW + a USB-ESP32 bridge (plan fallback).
- The Pi side (Mosquitto, `edge_inbound` dedup, adapter, clock responder) is E2.
