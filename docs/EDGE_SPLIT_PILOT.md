# Edge Split — wireless ESP32 reader → Pi (pilot status)

Splits the cabinet cycle reader off the Pi onto a **dumb store-and-forward ESP32** that
talks to the Pi over MQTT, so the Pi keeps all cycle/business logic while the wireless
reader just publishes debounced edges. A **software simulator** impersonates the ESP32 so
the whole Pi receive pipeline can be validated with no hardware powered on.

> Operational specifics (the paired machineId, ZeroTier IPs, Pi login) live in the
> out-of-repo handoff notes, not here.

## Components (branch `reliability-overhaul`)
- **Firmware** — `edge/esp32-reader/` (E1): debounced edge input, NVS outbox (never-reset
  per-device seq + flash buffer), MQTT publish, ~5 s heartbeat, clock-sync request.
- **Wire protocol** — `edge/esp32-reader/src/Protocol.h`, canonical envelope in
  `lib/contracts/v1.ts`: `{ schemaVersion, machineId, seq, tsDevice, type, payload }`.
- **Pi ingest nodes** — `scripts/edge/build-ingest-nodes.mjs` emits
  `edge/nodered-import/edge-ingest.json` and merges the nodes into `edge/flows.json`:
  - `mis/edge/+/cycle` → build CALL → `edge_inbound_ingest()` → ack+forward
    (out1 → existing `function 1` for new edges only; out2 → `…/ack`)
  - `mis/edge/+/time/req` → clock responder → `…/time`
  - `mis/edge/+/heartbeat` → reader-liveness record; 5 s timer → evaluate → `readerOnline`
  - All MQTT nodes point at a **LOCAL** Mosquitto broker config (separate from cloud EMQX).
- **DB (edge `edge_outbox`)** — `scripts/edge/edge_inbound.sql` (`edge_inbound` with
  `UNIQUE(machine_id, seq)`, `edge_ack_state` contiguous water mark, `edge_inbound_ingest()`),
  `scripts/edge/outbox_enqueue.sql` (atomic `outbox_enqueue()`).
- **Simulator** — `scripts/edge/mock-esp32.mjs`: byte-matches the firmware envelopes and
  reproduces its behaviour (monotonic clock + Pi-learned offset applied at publish;
  never-reset seq persisted to a `--seq-file`; unacked buffer replayed oldest-first on
  reconnect). Scenario flags cover the §9 bench gate (count parity, broker-kill/power-blip
  replay, `--stop-heartbeat-after` DATA_LOSS, `--stoppage`).

## Deploy order (matters)
1. Mosquitto bench listener on the Pi (`127.0.0.1:1883`; add the ZeroTier IP if the sim runs
   off-box). `allow_anonymous` is **bench-only** — remove before production.
2. Run both SQL files into the edge DB **before** deploying the flow.
3. Add the `contextStorage` block (`edge/settings.contextStorage.snippet.js`) to the Pi's
   `settings.js` and **restart Node-RED** before importing the flow (Phase-6 state uses the
   `file` store).
4. Deploy `edge/flows.json` (full flow — carries the scripted edits *and* the ingest nodes).
   Keep `rpi-gpio in` pin-17 disabled so only the wireless/sim path feeds `function 1`.

## Validation status (2026-06-15)
Deployed to the pilot Pi and validated **live** end-to-end with the simulator:
cycle → contiguous ack (seq 1→12), clock-sync handshake (`clockSynced`→true, real-UTC
`tsDevice`), 5 s heartbeats. DB confirmed `edge_inbound` 12 rows / 12 distinct seqs / 1→12,
`edge_ack_state.last_contiguous_seq = 12`, `outbox_messages` enqueued. Remaining: the bench
scenarios (§9.3/9.6/9.7) and the cloud/dashboard side (`MachineCycle`, DATA_LOSS amber,
`/api/health/consistency` `reader_link`, one `AlertIncident` per stoppage).

## Notes
- Pilot reuses a **real** machineId — keep `rpi-gpio` disabled during sim runs, and clear the
  sim test rows (`TRUNCATE edge_inbound` + fresh `--seq-file`, or set `--seq`) before go-live.
- Rollback: redeploy the saved flow backup, disable the `mqtt in` nodes, re-enable
  `rpi-gpio in` pin-17, remove the bench Mosquitto conf.
