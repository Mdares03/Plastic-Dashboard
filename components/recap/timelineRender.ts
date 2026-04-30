import type { RecapTimelineSegment } from "@/lib/recap/types";

export const TIMELINE_COLORS: Record<RecapTimelineSegment["type"], string> = {
  production: "bg-emerald-500 text-black",
  "mold-change": "bg-sky-400 text-black",
  macrostop: "bg-red-500 text-white",
  microstop: "bg-orange-500 text-black",
  "slow-cycle": "bg-orange-500 text-black",
  idle: "bg-zinc-700 text-zinc-300",
};

export const LABEL_MIN_WIDTH_PCT = 5;
export const SEGMENT_MIN_WIDTH_PCT = 0.3;

export function formatTime(valueMs: number, locale: string) {
  return new Date(valueMs).toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatDuration(startMs: number, endMs: number) {
  const totalMin = Math.max(0, Math.round((endMs - startMs) / 60000));
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}h ${m}m`;
}

export function normalizeTimelineSegments(
  segments: RecapTimelineSegment[],
  rangeStartMs: number,
  rangeEndMs: number
) {
  const ordered = [...segments]
    .map((segment) => ({
      ...segment,
      startMs: Math.max(rangeStartMs, segment.startMs),
      endMs: Math.min(rangeEndMs, segment.endMs),
    }))
    .filter((segment) => segment.endMs > segment.startMs)
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);

  const out: RecapTimelineSegment[] = [];
  let cursor = rangeStartMs;

  for (const segment of ordered) {
    if (segment.startMs > cursor) {
      out.push({
        type: "idle",
        startMs: cursor,
        endMs: segment.startMs,
        durationSec: Math.max(0, Math.trunc((segment.startMs - cursor) / 1000)),
        label: "Idle",
      });
    }

    const startMs = Math.max(cursor, segment.startMs);
    const endMs = Math.min(rangeEndMs, segment.endMs);
    if (endMs <= startMs) continue;

    if (segment.type === "production") {
      out.push({
        type: "production",
        startMs,
        endMs,
        durationSec: Math.max(0, Math.trunc((endMs - startMs) / 1000)),
        workOrderId: segment.workOrderId,
        sku: segment.sku,
        label: segment.label,
      });
    } else if (segment.type === "mold-change") {
      out.push({
        type: "mold-change",
        startMs,
        endMs,
        fromMoldId: segment.fromMoldId,
        toMoldId: segment.toMoldId,
        durationSec: Math.max(0, Math.trunc((endMs - startMs) / 1000)),
        label: segment.label,
      });
    } else if (segment.type === "macrostop" || segment.type === "microstop" || segment.type === "slow-cycle") {
      out.push({
        type: segment.type === "slow-cycle" ? "microstop" : segment.type,
        startMs,
        endMs,
        reason: segment.reason,
        reasonLabel: segment.reasonLabel ?? segment.reason,
        durationSec: Math.max(0, Math.trunc((endMs - startMs) / 1000)),
        label: segment.label,
      });
    } else {
      out.push({
        type: "idle",
        startMs,
        endMs,
        durationSec: Math.max(0, Math.trunc((endMs - startMs) / 1000)),
        label: segment.label,
      });
    }

    cursor = endMs;
    if (cursor >= rangeEndMs) break;
  }

  if (cursor < rangeEndMs) {
    out.push({
      type: "idle",
      startMs: cursor,
      endMs: rangeEndMs,
      durationSec: Math.max(0, Math.trunc((rangeEndMs - cursor) / 1000)),
      label: "Idle",
    });
  }

  return out;
}

export function computeWidths(segments: RecapTimelineSegment[], totalMs: number, minPct: number) {
  if (!segments.length) return [];
  const base = segments.map((segment) => ((segment.endMs - segment.startMs) / totalMs) * 100);
  const effectiveMin = Math.min(minPct, 100 / segments.length);
  let widths = base.map((pct) => Math.max(pct, effectiveMin));

  const sum = widths.reduce((acc, value) => acc + value, 0);
  if (sum > 100) {
    const overflow = sum - 100;
    const slacks = widths.map((value) => Math.max(0, value - effectiveMin));
    const totalSlack = slacks.reduce((acc, value) => acc + value, 0);
    if (totalSlack > 0) {
      widths = widths.map((value, index) => value - (overflow * slacks[index]) / totalSlack);
    } else {
      const scale = 100 / sum;
      widths = widths.map((value) => value * scale);
    }
  } else if (sum < 100) {
    const deficit = 100 - sum;
    const totalBase = base.reduce((acc, value) => acc + (value > 0 ? value : 1), 0);
    widths = widths.map(
      (value, index) => value + (deficit * (base[index] > 0 ? base[index] : 1)) / totalBase
    );
  }

  const rounded = widths.map((value) => Number(value.toFixed(4)));
  const roundedSum = rounded.reduce((acc, value) => acc + value, 0);
  const delta = Number((100 - roundedSum).toFixed(4));
  if (rounded.length > 0) {
    rounded[rounded.length - 1] = Number(Math.max(0, rounded[rounded.length - 1] + delta).toFixed(4));
  }
  return rounded;
}
