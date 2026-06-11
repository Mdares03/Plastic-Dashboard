/**
 * R5 (downtime authority).
 *
 * `ReasonEntry` (kind `downtime`) is the ONLY source for downtime durations.
 * The old `max(eventSum, reasonSum)` rule at lib/recap/getRecapData.ts:758 — the
 * hidden double-authority that let two sources silently disagree — is ABOLISHED.
 * MachineEvent is for live state + alerting only (see lib/metrics/events.ts).
 *
 * Each episode is clamped to its overlap with the window, and open/over-long
 * episodes are capped at MAX_OPEN_EPISODE_MS (12 h) — the generalization of the
 * stuck-mold-change fix. Planned vs unplanned is decided once, by reasonCode.
 */
import { MAX_OPEN_EPISODE_MS } from "./spec";
import type {
  DowntimeReasonBucket,
  DowntimeSummary,
  ReasonRow,
  ResolvedWindow,
} from "./types";

/** Reason codes that count as planned downtime (visible, but never "unplanned"). */
export const DEFAULT_PLANNED_CODES = new Set(["MOLD_CHANGE"]);

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Resolve a ReasonEntry into a clamped [start, end] interval in ms.
 * end = episodeEndTs ?? capturedAt; duration is capped at 12 h; start is derived
 * backwards from end so the episode can be clipped to the window overlap.
 */
function episodeInterval(r: ReasonRow): { startMs: number; endMs: number } {
  const endMs = (r.episodeEndTs ?? r.capturedAt).getTime();
  const rawMs = Math.max(0, (r.durationSeconds ?? 0) * 1000);
  const cappedMs = Math.min(rawMs, MAX_OPEN_EPISODE_MS); // R5: cap open / runaway episodes
  return { startMs: endMs - cappedMs, endMs };
}

/**
 * R5 — downtime for a window from ReasonEntry rows only. Each episode contributes
 * its overlap with [window.start, window.end]. Planned vs unplanned is split by
 * reasonCode. Returns minutes + a per-reason breakdown.
 */
export function computeDowntime(
  reasons: ReasonRow[],
  window: ResolvedWindow,
  plannedCodes: Set<string> = DEFAULT_PLANNED_CODES,
): DowntimeSummary {
  const winStart = window.start.getTime();
  const winEnd = window.end.getTime();
  const byCode = new Map<string, DowntimeReasonBucket & { seconds: number }>();
  let totalSec = 0;
  let plannedSec = 0;

  for (const r of reasons) {
    if (String(r.kind).toLowerCase() !== "downtime") continue;
    const { startMs, endMs } = episodeInterval(r);
    const overlapMs = Math.max(0, Math.min(endMs, winEnd) - Math.max(startMs, winStart));
    if (overlapMs <= 0) continue;
    const seconds = overlapMs / 1000;

    const code = String(r.reasonCode ?? "").trim().toUpperCase();
    const planned = plannedCodes.has(code);
    const label = (r.reasonLabel?.trim() || code) || "Sin razón";

    totalSec += seconds;
    if (planned) plannedSec += seconds;

    const bucket = byCode.get(code) ?? {
      reasonCode: code,
      reasonLabel: label,
      minutes: 0,
      count: 0,
      planned,
      seconds: 0,
    };
    bucket.seconds += seconds;
    bucket.count += 1;
    byCode.set(code, bucket);
  }

  const byReason: DowntimeReasonBucket[] = [...byCode.values()]
    .map(({ seconds, ...b }) => ({ ...b, minutes: round2(seconds / 60) }))
    .sort((a, b) => b.minutes - a.minutes);

  const totalMin = round2(totalSec / 60);
  const plannedMin = round2(plannedSec / 60);
  return {
    totalMin,
    plannedMin,
    unplannedMin: round2(Math.max(0, totalSec - plannedSec) / 60),
    byReason,
  };
}
