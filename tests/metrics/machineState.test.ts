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
});
