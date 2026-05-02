import type { TimelineEventRow } from "@/lib/recap/timeline";

/**
 * Shared classifier for machine state across /recap, /machines, /overview.
 *
 * State precedence (top wins):
 *   1. OFFLINE             — heartbeat dead
 *   2. MOLD_CHANGE         — operator initiated mold swap
 *   3. STOPPED             — should be producing, isn't
 *   4. DATA_LOSS           — producing but tracking off (operator forgot START)
 *   5. IDLE                — nothing loaded, nothing running, nothing expected
 *   6. RUNNING             — healthy
 *
 * Inputs are intentionally raw and computed by the caller, not fetched here,
 * so this module stays pure (testable, no DB/Prisma dependency).
 */

export type MachineStateName =
  | "offline"
  | "mold-change"
  | "stopped"
  | "data-loss"
  | "idle"
  | "running";

export type StoppedReason = "machine_fault" | "not_started";
export type DataLossReason = "untracked";

export type MachineStateResult =
  | { state: "offline"; lastSeenMs: number | null; offlineForMin: number }
  | {
      state: "mold-change";
      moldChangeStartMs: number | null;
      moldChangeMin: number;
    }
  | {
      state: "stopped";
      reason: StoppedReason;
      ongoingStopMin: number;
      stopStartedAtMs: number | null;
    }
  | {
      state: "data-loss";
      reason: DataLossReason;
      untrackedCycleCount: number;
      untrackedSinceMs: number | null;
      untrackedForMin: number;
    }
  | { state: "idle" }
  | { state: "running" };

export type MachineStateInputs = {
  /** Heartbeat freshness — true if the Pi has been seen within the offline threshold */
  heartbeatAlive: boolean;
  /** Last heartbeat timestamp in ms (or null if never seen) */
  lastSeenMs: number | null;
  /** Computed offline duration in ms — used when heartbeatAlive is false */
  offlineForMs: number;

  /** Operator pressed START — true if latest KPI snapshot has trackingEnabled=true */
  trackingEnabled: boolean;

  /** A work order with status RUNNING or PENDING is currently assigned */
  hasActiveWorkOrder: boolean;

  /** Active mold-change event (from timeline events) */
  activeMoldChange: { startedAtMs: number } | null;

  /** Active macrostop event (from timeline events) — fires when tracking on + no cycles */
  activeMacrostop: { startedAtMs: number } | null;

  /**
   * Untracked cycles arriving while tracking is OFF.
   * Caller computes by counting MachineCycle rows in the last UNTRACKED_WINDOW_MS
   * where ts > latestKpi.ts (so they're "after" the tracking-off snapshot).
   */
  untrackedCycles: { count: number; oldestTsMs: number | null };

  /**
   * Most recent cycle timestamp regardless of tracking — used as a sanity check
   * for IDLE classification.
   */
  lastCycleTsMs: number | null;
};

// Trigger thresholds — tunable
const DATA_LOSS_MIN_CYCLES = 5;
const DATA_LOSS_MIN_DURATION_MS = 10 * 60 * 1000; // 10 min
const RECENT_CYCLE_MS = 15 * 60 * 1000; // for IDLE check — "no cycles in 15 min"

export function classifyMachineState(
  inputs: MachineStateInputs,
  nowMs: number
): MachineStateResult {
  // 1. OFFLINE — wins over everything. If we can't see the Pi, nothing else is reliable.
  if (!inputs.heartbeatAlive) {
    return {
      state: "offline",
      lastSeenMs: inputs.lastSeenMs,
      offlineForMin: Math.max(0, Math.floor(inputs.offlineForMs / 60000)),
    };
  }

  // 2. MOLD_CHANGE — operator-initiated, suppresses STOPPED/ATTENTION even if cycles missing
  if (inputs.activeMoldChange) {
    return {
      state: "mold-change",
      moldChangeStartMs: inputs.activeMoldChange.startedAtMs,
      moldChangeMin: Math.max(
        0,
        Math.floor((nowMs - inputs.activeMoldChange.startedAtMs) / 60000)
      ),
    };
  }

  // 3. DATA_LOSS — tracking off but cycles arriving. Operator forgot START.
  // Check this BEFORE STOPPED because cycles ARE arriving (so the "no cycles" branch
  // would never fire), but we still want to flag it.
  if (!inputs.trackingEnabled && inputs.untrackedCycles.count > 0) {
    const oldest = inputs.untrackedCycles.oldestTsMs;
    const durationMs = oldest != null ? nowMs - oldest : 0;
    const tripped =
      inputs.untrackedCycles.count >= DATA_LOSS_MIN_CYCLES ||
      durationMs >= DATA_LOSS_MIN_DURATION_MS;

    if (tripped) {
      return {
        state: "data-loss",
        reason: "untracked",
        untrackedCycleCount: inputs.untrackedCycles.count,
        untrackedSinceMs: oldest,
        untrackedForMin: Math.max(0, Math.floor(durationMs / 60000)),
      };
    }
    // Not yet tripped — fall through to other checks (likely RUNNING since cycles are coming)
  }

  // 4. STOPPED — should be producing, isn't. Two reasons:
  //    a) machine_fault: operator pressed START, macrostop event active → mechanical issue
  //    b) not_started: operator never pressed START but a WO is loaded
  if (inputs.activeMacrostop && inputs.trackingEnabled) {
    const startedAt = inputs.activeMacrostop.startedAtMs;
    return {
      state: "stopped",
      reason: "machine_fault",
      ongoingStopMin: Math.max(0, Math.floor((nowMs - startedAt) / 60000)),
      stopStartedAtMs: startedAt,
    };
  }

  if (inputs.hasActiveWorkOrder && !inputs.trackingEnabled) {
    // Operator hasn't started production despite a loaded WO.
    // We don't have a precise "since when" for this — best estimate is "since latest
    // KPI snapshot reported trackingEnabled=false," but that's not in the inputs.
    // For now, report ongoingStopMin=0 and let the caller refine if needed.
    return {
      state: "stopped",
      reason: "not_started",
      ongoingStopMin: 0,
      stopStartedAtMs: null,
    };
  }

  // 5. IDLE — no one expects this machine to be doing anything right now.
  // No tracking, no WO, no recent cycles. Calm gray.
  const cycledRecently =
    inputs.lastCycleTsMs != null && nowMs - inputs.lastCycleTsMs <= RECENT_CYCLE_MS;
  if (!inputs.trackingEnabled && !inputs.hasActiveWorkOrder && !cycledRecently) {
    return { state: "idle" };
  }

  // 6. RUNNING — default. Tracking on, WO loaded, cycles flowing.
  return { state: "running" };
}