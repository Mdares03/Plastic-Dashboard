// Edge split E2 (plan §E) — "Clock responder" function node.
// IN:  mqtt-in on topic  mis/edge/+/time/req   ({ machineId, reqDeviceMs })
// OUT: mqtt-out — topic mis/edge/<id>/time      ({ reqDeviceMs, piUtcMs })
//
// The ESP32 has no RTC. It sends its monotonic reqDeviceMs; we echo it with the
// Pi's current UTC so the ESP32 can compute offset = piUtcMs + RTT/2 - recvDeviceMs.
// IMPORTANT: the Pi's own clock must be NTP-synced (P6.4) for this to be correct —
// the consistency health check surfaces both clocks (plan §E).

let req = msg.payload;
if (typeof req === "string") {
    try { req = JSON.parse(req); } catch (e) { return null; }
}
if (!req || !req.machineId) return null;

return {
    topic: "mis/edge/" + req.machineId + "/time",
    payload: JSON.stringify({
        reqDeviceMs: Number(req.reqDeviceMs) || 0,
        piUtcMs: Date.now(),
    }),
};
