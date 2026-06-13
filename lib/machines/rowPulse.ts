// Shared helpers for the Machines / Recap list views:
//  - rowPulse: maps a machine's current state to the <tr> classes that make the
//    whole row pulse in that state's color (blue mold-change, red stop, orange
//    microstop, dark idle). Running rows stay calm so problems pop visually.
//    The colored pulse animations live in app/globals.css (row-pulse-*).
//  - avgCycle: average actual cycle time over the last-hour cycle points already
//    fetched per row.

export type MachinePulseState =
  | "mold-change"
  | "startup-wait"
  | "stopped"
  | "microstop"
  | "idle"
  | "running"
  | "offline"
  // Edge split (plan §D): Pi up but the wireless ESP32 reader is dead → state unknown.
  | "data-loss";

/**
 * Map a Recap timeline segment type (or "offline") to the pulse vocabulary.
 * Used by the Recap list, whose rows carry miniTimeline segments directly.
 */
export function pulseStateFromSegmentType(
  type:
    | "production"
    | "mold-change"
    | "macrostop"
    | "microstop"
    | "slow-cycle"
    | "startup-wait"
    | "idle"
    | "offline",
): MachinePulseState {
  switch (type) {
    case "mold-change":
      return "mold-change";
    case "startup-wait":
      return "startup-wait";
    case "macrostop":
      return "stopped";
    case "microstop":
    case "slow-cycle":
      return "microstop";
    case "offline":
      return "offline";
    case "idle":
      return "idle";
    case "production":
    default:
      return "running";
  }
}

/**
 * Classes for a clickable list row that pulses in its state color.
 * `urgent` bumps a stopped row to the strongest red (e.g. stopped >= 5 min).
 */
export function rowPulse(state: MachinePulseState, opts?: { urgent?: boolean }): string {
  const base = "cursor-pointer";
  switch (state) {
    case "mold-change":
      return `${base} border-l-4 border-l-sky-400 animate-row-pulse-blue`;
    case "startup-wait":
      return `${base} border-l-4 border-l-violet-400 animate-row-pulse-violet`;
    case "stopped":
      return opts?.urgent
        ? `${base} border-l-4 border-l-red-500 animate-row-pulse-red-strong`
        : `${base} border-l-4 border-l-red-400 animate-row-pulse-red`;
    case "microstop":
      return `${base} border-l-4 border-l-orange-500 animate-row-pulse-orange`;
    case "idle":
      return `${base} border-l-4 border-l-zinc-600 animate-row-pulse-dark`;
    case "offline":
      return `${base} opacity-50`;
    case "data-loss":
      // Amber dashed: a distinct "we can't see the machine" signal, not a red stop.
      return `${base} border-l-4 border-l-amber-400 border-dashed animate-row-pulse-dark`;
    case "running":
    default:
      return `${base} hover:bg-white/5`;
  }
}

/** Average actual cycle time (seconds) over the supplied points, or null if none. */
export function avgCycle(cycles: ReadonlyArray<{ actual: number }>): number | null {
  const vals = cycles.map((c) => c.actual).filter((n) => Number.isFinite(n));
  if (vals.length === 0) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}
