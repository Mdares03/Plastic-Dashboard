"use client";

import type { RecapTimelineSegment } from "@/lib/recap/types";

type Props = {
  rangeStart: string;
  rangeEnd: string;
  segments: RecapTimelineSegment[];
  locale: string;
};

const COLORS: Record<RecapTimelineSegment["type"], string> = {
  production: "bg-emerald-500 text-black",
  "mold-change": "bg-sky-400 text-black",
  macrostop: "bg-red-500 text-white",
  microstop: "bg-orange-500 text-black",
  "slow-cycle": "bg-amber-500 text-black",
  idle: "bg-zinc-600 text-zinc-300",
};
const MIN_SEGMENT_PCT = 0.3;
const LABEL_MIN_PCT = 5;

function fmtTime(valueMs: number, locale: string) {
  return new Date(valueMs).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" });
}

function fmtDuration(startMs: number, endMs: number) {
  const totalMin = Math.max(0, Math.round((endMs - startMs) / 60000));
  if (totalMin < 60) return `${totalMin}m`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}h ${m}m`;
}

function shouldMergeByType(type: RecapTimelineSegment["type"]) {
  return type === "macrostop" || type === "microstop" || type === "slow-cycle" || type === "idle";
}

function normalizeForRender(segments: RecapTimelineSegment[], startMs: number, endMs: number) {
  const ordered = segments
    .map((segment) => ({
      ...segment,
      startMs: Math.max(startMs, segment.startMs),
      endMs: Math.min(endMs, segment.endMs),
    }))
    .filter((segment) => segment.endMs > segment.startMs)
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);

  const out: RecapTimelineSegment[] = [];
  let cursor = startMs;

  for (const segment of ordered) {
    if (segment.startMs > cursor) {
      const prev = out[out.length - 1];
      if (prev) {
        prev.endMs = segment.startMs;
      } else {
        out.push({
          type: "idle",
          startMs: cursor,
          endMs: segment.startMs,
          durationSec: Math.max(0, Math.trunc((segment.startMs - cursor) / 1000)),
          label: "Idle",
        });
      }
    }

    const normalizedStart = Math.max(cursor, segment.startMs);
    const normalizedEnd = Math.min(endMs, segment.endMs);
    if (normalizedEnd <= normalizedStart) continue;

    const normalizedSegment: RecapTimelineSegment = {
      ...segment,
      startMs: normalizedStart,
      endMs: normalizedEnd,
    };
    const prev = out[out.length - 1];

    if (
      prev &&
      prev.type === normalizedSegment.type &&
      shouldMergeByType(prev.type) &&
      prev.endMs === normalizedSegment.startMs
    ) {
      prev.endMs = normalizedSegment.endMs;
    } else {
      out.push(normalizedSegment);
    }
    cursor = normalizedEnd;
    if (cursor >= endMs) break;
  }

  if (cursor < endMs) {
    const prev = out[out.length - 1];
    if (prev) {
      prev.endMs = endMs;
    } else {
      out.push({
        type: "idle",
        startMs: cursor,
        endMs,
        durationSec: Math.max(0, Math.trunc((endMs - cursor) / 1000)),
        label: "Idle",
      });
    }
  }

  return out.filter((segment) => segment.endMs > segment.startMs);
}

function computeWidths(segments: RecapTimelineSegment[], totalMs: number, minPct: number) {
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
    widths = widths.map((value, index) => value + (deficit * (base[index] > 0 ? base[index] : 1)) / totalBase);
  }

  const rounded = widths.map((value) => Number(value.toFixed(4)));
  const roundedSum = rounded.reduce((acc, value) => acc + value, 0);
  const delta = Number((100 - roundedSum).toFixed(4));
  if (rounded.length > 0) {
    rounded[rounded.length - 1] = Number(Math.max(0, rounded[rounded.length - 1] + delta).toFixed(4));
  }
  return rounded;
}

export default function RecapTimeline({ rangeStart, rangeEnd, segments, locale }: Props) {
  const startMs = new Date(rangeStart).getTime();
  const endMs = new Date(rangeEnd).getTime();
  const totalMs = Math.max(1, endMs - startMs);
  const normalized = normalizeForRender(segments, startMs, endMs);
  const widths = computeWidths(normalized, totalMs, MIN_SEGMENT_PCT);

  return (
    <div className="mb-4 rounded-2xl border border-white/10 bg-black/40 p-3">
      <div className="mb-2 text-xs uppercase tracking-wide text-zinc-400">Timeline 24h</div>
      <div className="flex h-14 w-full overflow-hidden rounded-xl border border-white/10">
        {normalized.map((segment, index) => {
          const widthPct = widths[index] ?? 0;
          const title = `${segment.type} · ${fmtTime(segment.startMs, locale)}-${fmtTime(segment.endMs, locale)} · ${fmtDuration(segment.startMs, segment.endMs)}${segment.label ? ` · ${segment.label}` : ""}`;
          return (
            <div
              key={`${segment.type}:${segment.startMs}:${segment.endMs}:${segment.label}`}
              className={`flex h-full shrink-0 items-center justify-center truncate px-2 text-xs font-semibold ${COLORS[segment.type]} ${
                index === 0 ? "rounded-l-xl" : ""
              } ${index === normalized.length - 1 ? "rounded-r-xl" : ""}`}
              style={{ width: `${Math.max(0, widthPct)}%` }}
              title={title}
            >
              {widthPct > LABEL_MIN_PCT ? segment.label : ""}
            </div>
          );
        })}
      </div>
    </div>
  );
}
