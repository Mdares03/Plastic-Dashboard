import { describe, expect, it } from "vitest";
import { deriveMachineState } from "@/lib/metrics/machineState";
import { at, event, HOUR, MIN, T0 } from "../fixtures/scenario";

// "now" sits 1h after T0 so recent events are within their stale windows.
const NOW = at(1 * HOUR);
const freshHb = at(1 * HOUR - 1 * MIN);

describe("R8 — machine state ladder", () => {
  it("offline wins when the heartbeat is missing or stale", () => {
    expect(
      deriveMachineState({
        heartbeatTs: null,
        heartbeatStatus: "RUN",
        events: [],
        cycleTimestampsMs: [],
        now: NOW,
      }),
    ).toBe("offline");

    expect(
      deriveMachineState({
        heartbeatTs: at(0), // 1h old → stale (> 5min)
        heartbeatStatus: "RUN",
        events: [],
        cycleTimestampsMs: [],
        now: NOW,
      }),
    ).toBe("offline");
  });

  it("mold-change outranks a stop when no cycle has resumed", () => {
    const events = [event("mold-change", at(50 * MIN), { status: "active" })];
    expect(
      deriveMachineState({
        heartbeatTs: freshHb,
        heartbeatStatus: "STOP",
        events,
        cycleTimestampsMs: [],
        now: NOW,
      }),
    ).toBe("mold-change");
  });

  it("stopped when a macrostop is active", () => {
    const events = [event("macrostop", at(59 * MIN), { status: "active" })];
    expect(
      deriveMachineState({
        heartbeatTs: freshHb,
        heartbeatStatus: "RUN",
        events,
        cycleTimestampsMs: [],
        now: NOW,
      }),
    ).toBe("stopped");
  });

  // Demo feedback item 9: a stale "active" macrostop must not survive a resumed
  // cycle. Without the resume guard the machine reads "stopped 9d" while it runs.
  it("macrostop clears once a cycle resumes after it started (no more 'stopped 9d')", () => {
    const events = [event("macrostop", at(58 * MIN), { status: "active" })];
    expect(
      deriveMachineState({
        heartbeatTs: freshHb,
        heartbeatStatus: "RUN",
        events,
        cycleTimestampsMs: [at(59 * MIN).getTime()], // cycle after the stop start → resumed
        now: NOW,
      }),
    ).toBe("running");
  });

  it("microstop ranks below stop, above running", () => {
    const events = [event("microstop", at(59 * MIN), { status: "active" })];
    expect(
      deriveMachineState({
        heartbeatTs: freshHb,
        heartbeatStatus: "RUN",
        events,
        cycleTimestampsMs: [],
        now: NOW,
      }),
    ).toBe("microstop");
  });

  it("running on a RUN heartbeat with no active incident", () => {
    expect(
      deriveMachineState({
        heartbeatTs: freshHb,
        heartbeatStatus: "RUN",
        events: [],
        cycleTimestampsMs: [at(58 * MIN).getTime()],
        now: NOW,
      }),
    ).toBe("running");
  });

  it("idle on an IDLE heartbeat", () => {
    expect(
      deriveMachineState({
        heartbeatTs: freshHb,
        heartbeatStatus: "IDLE",
        events: [],
        cycleTimestampsMs: [],
        now: NOW,
      }),
    ).toBe("idle");
  });

  it("mold-change clears once a cycle resumes after it started", () => {
    const events = [event("mold-change", at(50 * MIN), { status: "active" })];
    expect(
      deriveMachineState({
        heartbeatTs: freshHb,
        heartbeatStatus: "RUN",
        events,
        cycleTimestampsMs: [at(55 * MIN).getTime()], // cycle after mold start → resumed
        now: NOW,
      }),
    ).toBe("running");
  });

  // Edge split (plan §D): the wireless ESP32 reader can die while the Pi is up.
  it("data-loss when the Pi is online but the reader is dead", () => {
    expect(
      deriveMachineState({
        heartbeatTs: freshHb,
        heartbeatStatus: "RUN",
        readerOnline: false,
        events: [],
        cycleTimestampsMs: [],
        now: NOW,
      }),
    ).toBe("data-loss");
  });

  it("data-loss outranks a leaked stop event (dead reader != stopped machine)", () => {
    const events = [event("macrostop", at(59 * MIN), { status: "active" })];
    expect(
      deriveMachineState({
        heartbeatTs: freshHb,
        heartbeatStatus: "STOP",
        readerOnline: false,
        events,
        cycleTimestampsMs: [],
        now: NOW,
      }),
    ).toBe("data-loss");
  });

  it("offline still outranks data-loss (no Pi heartbeat = we know nothing)", () => {
    expect(
      deriveMachineState({
        heartbeatTs: null,
        heartbeatStatus: "RUN",
        readerOnline: false,
        events: [],
        cycleTimestampsMs: [],
        now: NOW,
      }),
    ).toBe("offline");
  });

  it("reader online / not reported does NOT trigger data-loss", () => {
    for (const readerOnline of [true, null, undefined]) {
      expect(
        deriveMachineState({
          heartbeatTs: freshHb,
          heartbeatStatus: "RUN",
          readerOnline,
          events: [],
          cycleTimestampsMs: [at(58 * MIN).getTime()],
          now: NOW,
        }),
      ).toBe("running");
    }
  });
});
