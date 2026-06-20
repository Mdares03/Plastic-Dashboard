#pragma once
// MIS Control Tower — ESP32 device clock & offset (plan §E).
//
// The ESP32 has no RTC. It keeps a monotonic ms clock (esp_timer, no rollover in
// practice) and an OFFSET to the Pi's UTC, learned via a request/response with the
// Pi. Absolute UTC = deviceMs() + offset. Raw deviceMs is what we store in the
// outbox buffer; the offset is applied at publish time, so a later resync
// retroactively corrects the absolute timestamps of still-buffered edges.

#include <Arduino.h>
#include "esp_timer.h"

class DeviceClock {
public:
  // Monotonic milliseconds since boot. int64 → no 49.7-day millis() rollover.
  int64_t deviceMs() const { return esp_timer_get_time() / 1000; }

  // Absolute UTC ms for a given raw device timestamp (offset applied at send).
  int64_t toUtc(int64_t dMs) const { return dMs + _offsetMs; }
  int64_t nowUtc() const { return toUtc(deviceMs()); }

  bool synced() const {
    if (!_haveOffset) return false;
    return (deviceMs() - _lastSyncDeviceMs) <= CFG_TIMESYNC_STALE_MS;
  }

  // Called when the Pi's time reply arrives. We sent reqDeviceMs in the request;
  // recvDeviceMs is "now". NTP-lite: assume symmetric transit over the local AP.
  //   RTT    = recvDeviceMs - reqDeviceMs
  //   offset = piUtcMs + RTT/2 - recvDeviceMs
  void applyTimeReply(int64_t reqDeviceMs, int64_t piUtcMs, int64_t recvDeviceMs) {
    const int64_t rtt = recvDeviceMs - reqDeviceMs;
    _offsetMs = piUtcMs + (rtt / 2) - recvDeviceMs;
    _lastSyncDeviceMs = recvDeviceMs;
    _haveOffset = true;
  }

  int64_t offsetMs() const { return _offsetMs; }

private:
  int64_t _offsetMs = 0;
  int64_t _lastSyncDeviceMs = 0;
  bool _haveOffset = false;
};
