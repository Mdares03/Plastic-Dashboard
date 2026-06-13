#pragma once
// MIS Control Tower — ESP32 debounced edge input (plan §A).
//
// Reproduces the Pi's old `rpi-gpio in` behavior: emit on EVERY confirmed level
// change (both 0->1 and 1->0), debounced ~25ms, so the Pi's downstream cycle /
// zeroStreak logic is unchanged. The timestamp is taken at the RAW transition
// instant (when the change is first seen), not after the debounce settles, so
// edge placement stays faithful to the physical signal.

#include <Arduino.h>
#include "config.h"

class EdgeInput {
public:
  void begin() {
    pinMode(CFG_INPUT_PIN, INPUT);
    _stable = readLevel();
    _candidate = _stable;
  }

  // Poll often (every loop). Returns true and fills `level`/`tDeviceMs` on a
  // confirmed transition. tDeviceMs is captured at the first raw change.
  bool poll(int64_t deviceMs, uint8_t& level, int64_t& tDeviceMs) {
    uint8_t raw = readLevel();
    if (raw != _candidate) {
      // New raw value — start (or restart) the debounce window, remember when.
      _candidate = raw;
      _candidateSinceMs = deviceMs;
      _candidateTsMs = deviceMs; // physical-edge timestamp
    } else if (_candidate != _stable &&
               (deviceMs - _candidateSinceMs) >= CFG_DEBOUNCE_MS) {
      // Held the new value long enough → confirm the transition.
      _stable = _candidate;
      level = _stable;
      tDeviceMs = _candidateTsMs;
      return true;
    }
    return false;
  }

  uint8_t level() const { return _stable; }

private:
  uint8_t readLevel() const {
    int v = digitalRead(CFG_INPUT_PIN);
#if CFG_INPUT_ACTIVE_HIGH
    return v ? 1 : 0;
#else
    return v ? 0 : 1;
#endif
  }

  uint8_t _stable = 0;
  uint8_t _candidate = 0;
  int64_t _candidateSinceMs = 0;
  int64_t _candidateTsMs = 0;
};
