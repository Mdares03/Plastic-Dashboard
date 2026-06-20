#pragma once
// MIS Control Tower — ESP32 store-and-forward outbox (plan §A).
//
// Mirrors the Pi→cloud outbox philosophy on the ESP32→Pi hop:
//   • monotonic per-device seq, PERSISTED so it never resets across reboot
//     (same no-reset rule as scripts/edge/outbox_enqueue.sql);
//   • unacked edges held in NVS (flash) so they survive a 24V power blip, not
//     just sleep — replayed from the oldest unacked on reconnect;
//   • the Pi acks a high-water seq; everything <= ackSeq is trimmed.
//
// Entries store the RAW device-ms timestamp (not absolute UTC): the offset is
// applied at publish, so a clock resync corrects buffered edges retroactively.

#include <Arduino.h>
#include <Preferences.h>
#include "config.h"

struct EdgeRecord {
  uint64_t seq;
  int64_t tDeviceMs; // raw monotonic ms at the physical edge
  uint8_t channel;
  uint8_t level;     // 0/1 logical relay level
};

class OutboxStore {
public:
  void begin() {
    _nvs.begin("misedge", false);
    _seqNext = _nvs.getULong64("seqNext", 1);
    size_t blobLen = _nvs.getBytesLength("buf");
    if (blobLen > 0 && (blobLen % sizeof(EdgeRecord)) == 0) {
      _count = blobLen / sizeof(EdgeRecord);
      if (_count > CFG_BUFFER_CAPACITY) _count = CFG_BUFFER_CAPACITY;
      _nvs.getBytes("buf", _buf, _count * sizeof(EdgeRecord));
    } else {
      _count = 0;
    }
  }

  // Assign the next seq, append the edge, persist. Drops the OLDEST entry if full
  // (an outage longer than capacity loses the oldest edges — surfaced as a genuine
  // gap on the Pi, which is the DATA_LOSS story, not silent corruption).
  EdgeRecord enqueue(int64_t tDeviceMs, uint8_t channel, uint8_t level) {
    EdgeRecord rec{_seqNext, tDeviceMs, channel, level};
    _seqNext++;
    _nvs.putULong64("seqNext", _seqNext); // tiny write, every edge

    if (_count == CFG_BUFFER_CAPACITY) {
      memmove(&_buf[0], &_buf[1], (CFG_BUFFER_CAPACITY - 1) * sizeof(EdgeRecord));
      _count--;
    }
    _buf[_count++] = rec;
    persistBuf();
    return rec;
  }

  // Trim every entry with seq <= ackSeq (the Pi durably has them).
  void ackUpTo(uint64_t ackSeq) {
    size_t keep = 0;
    while (keep < _count && _buf[keep].seq <= ackSeq) keep++;
    if (keep == 0) return;
    _count -= keep;
    if (_count > 0) memmove(&_buf[0], &_buf[keep], _count * sizeof(EdgeRecord));
    persistBuf();
  }

  size_t depth() const { return _count; }
  bool empty() const { return _count == 0; }
  const EdgeRecord& at(size_t i) const { return _buf[i]; }

private:
  void persistBuf() { _nvs.putBytes("buf", _buf, _count * sizeof(EdgeRecord)); }

  Preferences _nvs;
  uint64_t _seqNext = 1;
  EdgeRecord _buf[CFG_BUFFER_CAPACITY];
  size_t _count = 0;
};
