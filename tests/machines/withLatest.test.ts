import { describe, expect, it } from "vitest";
import { mergeMachineOverviewRows } from "@/lib/machines/withLatest";

const NOW = new Date("2026-06-30T12:00:00.000Z");
const nowMs = NOW.getTime();
const DAY = 24 * 60 * 60 * 1000;

const baseMachine = {
  id: "m1",
  name: "Press 1",
  code: "P1",
  location: "Bay A",
  createdAt: NOW,
  updatedAt: NOW,
};

function hb(status: string, ageMs: number) {
  const ts = new Date(nowMs - ageMs);
  return { machineId: "m1", ts, tsServer: ts, status };
}

function macro(status: "active" | "resolved", startAgeMs: number, pingAgeMs: number) {
  return {
    machineId: "m1",
    ts: new Date(nowMs - pingAgeMs),
    status,
    startedAtMs: nowMs - startAgeMs,
  };
}

describe("mergeMachineOverviewRows — macrostop reconciliation (item 9)", () => {
  it("resolves a stale 9d macrostop when the live heartbeat is RUN", () => {
    const [row] = mergeMachineOverviewRows({
      machines: [baseMachine],
      heartbeats: [hb("RUN", 30 * 1000)], // fresh RUN
      macrostops: [macro("active", 9 * DAY, 30 * 1000)], // started 9d ago, freshly pinged
      now: NOW,
    });
    expect(row.latestMacrostop?.status).toBe("resolved");
  });

  it("treats ONLINE like RUN (liveness alias)", () => {
    const [row] = mergeMachineOverviewRows({
      machines: [baseMachine],
      heartbeats: [hb("ONLINE", 30 * 1000)],
      macrostops: [macro("active", 9 * DAY, 30 * 1000)],
      now: NOW,
    });
    expect(row.latestMacrostop?.status).toBe("resolved");
  });

  it("keeps a genuine fresh stop active (start ≈ now, even on a RUN liveness ping)", () => {
    const [row] = mergeMachineOverviewRows({
      machines: [baseMachine],
      heartbeats: [hb("RUN", 5 * 1000)],
      macrostops: [macro("active", 60 * 1000, 5 * 1000)], // started 1 min ago
      now: NOW,
    });
    expect(row.latestMacrostop?.status).toBe("active");
  });

  it("keeps the stop active when the heartbeat says STOP", () => {
    const [row] = mergeMachineOverviewRows({
      machines: [baseMachine],
      heartbeats: [hb("STOP", 30 * 1000)],
      macrostops: [macro("active", 9 * DAY, 30 * 1000)],
      now: NOW,
    });
    expect(row.latestMacrostop?.status).toBe("active");
  });

  it("does not suppress when the heartbeat itself is stale", () => {
    const [row] = mergeMachineOverviewRows({
      machines: [baseMachine],
      heartbeats: [hb("RUN", 30 * 60 * 1000)], // 30 min old → stale
      macrostops: [macro("active", 9 * DAY, 30 * 1000)],
      now: NOW,
    });
    expect(row.latestMacrostop?.status).toBe("active");
  });
});
