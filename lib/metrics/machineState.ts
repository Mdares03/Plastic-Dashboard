/**
 * R8 (machine state).
 *
 * One precedence ladder decides the displayed live state:
 *   offline > mold-change > startup-wait > stopped > microstop > running > idle
 *
 * Extracted verbatim from app/api/machines/[machineId]/route.ts so no view or
 * route keeps its own copy (the machines list, recap grid, and detail page must
 * agree). Freshness windows come from lib/metrics/spec.ts.
 */
import { activeEpisodeStartMs, resolvedEpisodeEndMs } from "./events";
import { MOLD_ACTIVE_STALE_MS, RECAP_HEARTBEAT_STALE_MS, STOP_ACTIVE_STALE_MS } from "./spec";
import type { EventRow } from "./types";
import type { MachinePulseState } from "@/lib/machines/rowPulse";

const PRODUCING_RECENTLY_MS = 15 * 60 * 1000;

export type MachineStateInput = {
  heartbeatTs: Date | null;
  heartbeatStatus: string | null;
  events: ReadonlyArray<EventRow>;
  /** Production-cycle timestamps (ms), ascending — used to detect resumption. */
  cycleTimestampsMs: number[];
  now?: Date;
};

/** R8 — derive the single live machine state from heartbeat + events + cycles. */
export function deriveMachineState(input: MachineStateInput): MachinePulseState {
  const nowMs = (input.now ?? new Date()).getTime();
  const hbStatus = String(input.heartbeatStatus ?? "").toUpperCase();
  const offline =
    !input.heartbeatTs || nowMs - input.heartbeatTs.getTime() > RECAP_HEARTBEAT_STALE_MS;

  const moldStartMs = activeEpisodeStartMs(input.events, "mold-change", nowMs, MOLD_ACTIVE_STALE_MS);
  // A mold change is over once production resumes after it started.
  const moldOngoing = moldStartMs != null && !input.cycleTimestampsMs.some((t) => t > moldStartMs);

  // "En espera de arranque": operator resolved the swap (end_ms) but no cycle yet.
  const moldResolvedEndMs = resolvedEpisodeEndMs(
    input.events,
    "mold-change",
    nowMs,
    MOLD_ACTIVE_STALE_MS,
  );
  const startupWaiting =
    !moldOngoing &&
    moldResolvedEndMs != null &&
    !input.cycleTimestampsMs.some((t) => t > moldResolvedEndMs);

  const macroActive = activeEpisodeStartMs(input.events, "macrostop", nowMs, STOP_ACTIVE_STALE_MS) != null;
  const microActive =
    activeEpisodeStartMs(input.events, "microstop", nowMs, STOP_ACTIVE_STALE_MS) != null ||
    activeEpisodeStartMs(input.events, "slow-cycle", nowMs, STOP_ACTIVE_STALE_MS) != null;

  const lastCycleMs = input.cycleTimestampsMs.length
    ? input.cycleTimestampsMs[input.cycleTimestampsMs.length - 1]
    : null;
  const producingRecently = lastCycleMs != null && nowMs - lastCycleMs < PRODUCING_RECENTLY_MS;

  if (offline) return "offline";
  if (moldOngoing) return "mold-change";
  if (startupWaiting && !macroActive) return "startup-wait";
  if (macroActive || hbStatus === "STOP" || hbStatus === "DOWN") return "stopped";
  if (microActive) return "microstop";
  if (hbStatus === "IDLE") return "idle";
  if (hbStatus === "RUN" || hbStatus === "ONLINE" || producingRecently) return "running";
  return "idle";
}
