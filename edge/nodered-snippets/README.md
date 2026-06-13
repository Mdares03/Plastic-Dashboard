# Node-RED edge-split input adapter (E2)

These three function bodies replace the local GPIO input with the wireless ESP32 feed
(plan §C). Brand-new nodes are built in the Node-RED editor (consistent with how Phase 6
handled new nodes); the *existing*-node device-time edits are scripted in E3.

All new MQTT nodes use a **new local mqtt-broker config** → the Pi's Mosquitto
(`192.168.4.1` or `127.0.0.1`, port `1883`). Do **not** reuse the cloud EMQX config.

## Build these nodes (on tab "Flow 2.1", id 1c5939a024275777)

**Input + dedup/ack chain:**

```
[mqtt in]  topic: mis/edge/+/cycle   (Output: a parsed JSON object)
   → [function] "Edge Inbound: build CALL"   (edge-inbound-build-call.js)
   → [mysql]    config "Edge Outbox" (fc9634aabefee16b)
   → [function] "Edge Inbound: ack + forward" (edge-inbound-ack-forward.js, 2 outputs)
        out 1 → [function 1]  (existing, id d8b64d16026af66d)
        out 2 → [mqtt out]    (topic left blank — set per msg.topic)
```

**Clock responder:**

```
[mqtt in]  topic: mis/edge/+/time/req   (Output: a parsed JSON object)
   → [function] "Clock responder"   (clock-responder.js)
   → [mqtt out]  (topic per msg.topic)
```

## Cut over the input

- **Disable the old GPIO node:** open `rpi-gpio in` pin 17 (id `d0beb2b0f0622d5b`) and
  either disconnect its wire to `function 1` or disable the node. After cutover, the only
  thing feeding `function 1` is the ESP32 path. (This is the E3 bench cutover step.)
- `function 1` itself is **unchanged** — it dedupes on `Number(msg.payload)` (the level)
  and passes the message (carrying `msg.tsDevice`) through to `Machine cycles`.

## Verify

`mosquitto_sub -t 'mis/edge/#' -v` should show `cycle` in, `ack` out, and `time` replies.
Each new edge → one `edge_inbound` row + an `ack` with the contiguous `ackSeq`; duplicate
replays → `dup` status, no second row, still acked.
