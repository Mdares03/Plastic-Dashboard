"use client";

import type { RecapTimelineSegment } from "@/lib/recap/types";

type Props = {
  rangeStart: string;
  rangeEnd: string;
  segments: RecapTimelineSegment[];
  locale: string;
};

const COLORS: Record<RecapTimelineSegment["type"], string> = {
  production: "bg-emerald-500 text-emerald-50",
  "mold-change": "bg-blue-400 text-blue-950",
  macrostop: "bg-red-500 text-red-50",
  microstop: "bg-orange-500 text-orange-50",
  "slow-cycle": "bg-amber-500 text-amber-950",
  idle: "bg-zinc-600 text-zinc-100",
};

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

export default function RecapTimeline({ rangeStart, rangeEnd, segments, locale }: Props) {
  const startMs = new Date(rangeStart).getTime();
  const endMs = new Date(rangeEnd).getTime();
  const totalMs = Math.max(1, endMs - startMs);

  const bars: RecapTimelineSegment[] = [];
  const dots: Array<{ leftPct: number; segment: RecapTimelineSegment }> = [];

  for (const segment of segments) {
    const widthPct = ((segment.endMs - segment.startMs) / totalMs) * 100;
    const leftPct = ((segment.startMs - startMs) / totalMs) * 100;
    if (widthPct < 1) {
      if (segment.type !== "idle" && leftPct > 0.5 && leftPct < 99.5) {
        dots.push({ leftPct, segment });
      }
    } else {
      bars.push(segment);
    }
  }

  return (
    <div className="mb-4 rounded-2xl border border-white/10 bg-black/40 p-3">
      <div className="mb-2 text-xs uppercase tracking-wide text-zinc-400">Timeline 24h</div>
      <div className="relative">
        <div className="flex h-12 w-full overflow-hidden rounded-xl border border-white/10">
          {bars.map((segment) => {
            const widthPct = ((segment.endMs - segment.startMs) / totalMs) * 100;
            const title = `${segment.type} · ${fmtTime(segment.startMs, locale)}-${fmtTime(segment.endMs, locale)} · ${fmtDuration(segment.startMs, segment.endMs)}${segment.label ? ` · ${segment.label}` : ""}`;
            return (
              <div
                key={`${segment.type}:${segment.startMs}:${segment.endMs}:${segment.label}`}
                className={`flex items-center justify-center truncate px-1 text-xs font-medium ${COLORS[segment.type]}`}
                style={{ width: `${widthPct}%` }}
                title={title}
              >
                {widthPct >= 6 ? segment.label : ""}
              </div>
            );
          })}
        </div>
        {dots.map(({ leftPct, segment }) => (
          <div
            key={`dot:${segment.type}:${segment.startMs}:${segment.endMs}`}
            className={`absolute top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full border border-black/30 ${COLORS[segment.type].split(" ")[0]}`}
            style={{ left: `${Math.max(0.3, Math.min(99.7, leftPct))}%` }}
            title={`${segment.type} · ${fmtTime(segment.startMs, locale)}-${fmtTime(segment.endMs, locale)} · ${fmtDuration(segment.startMs, segment.endMs)}`}
          />
        ))}
      </div>
    </div>
  );
}
