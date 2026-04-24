"use client";

import type { RecapTimelineSegment } from "@/lib/recap/types";
import {
  computeWidths,
  formatDuration,
  formatTime,
  normalizeTimelineSegments,
  TIMELINE_COLORS,
} from "@/components/recap/timelineRender";
import { useI18n } from "@/lib/i18n/useI18n";

type Props = {
  rangeStart: string;
  rangeEnd: string;
  segments: RecapTimelineSegment[];
  locale: string;
  muted?: boolean;
  hasData?: boolean;
};

const MIN_SEGMENT_PCT = 1.5;

export default function RecapMiniTimeline({
  rangeStart,
  rangeEnd,
  segments,
  locale,
  muted = false,
  hasData = true,
}: Props) {
  const { t } = useI18n();
  const startMs = new Date(rangeStart).getTime();
  const endMs = new Date(rangeEnd).getTime();
  const totalMs = Math.max(1, endMs - startMs);

  const normalized = normalizeTimelineSegments(segments, startMs, endMs);
  const widths = computeWidths(normalized, totalMs, MIN_SEGMENT_PCT);

  if (!hasData) {
    return (
      <div className="flex h-5 w-full items-center justify-center rounded-md bg-zinc-800/70 text-[10px] text-zinc-400">
        {t("recap.timeline.noData")}
      </div>
    );
  }

  if (!normalized.length) {
    return <div className="h-5 w-full rounded-md bg-zinc-700/70" />;
  }

  return (
    <div className="flex h-5 w-full overflow-hidden rounded-md">
      {normalized.map((segment, index) => {
        const widthPct = widths[index] ?? 0;
        const typeLabel =
          segment.type === "production"
            ? t("recap.timeline.type.production")
            : segment.type === "mold-change"
              ? t("recap.timeline.type.moldChange")
              : segment.type === "macrostop"
                ? t("recap.timeline.type.macrostop")
                : segment.type === "microstop" || segment.type === "slow-cycle"
                  ? t("recap.timeline.type.microstop")
                  : t("recap.timeline.type.idle");
        const title = `${typeLabel} · ${formatTime(segment.startMs, locale)}-${formatTime(segment.endMs, locale)} · ${formatDuration(segment.startMs, segment.endMs)}${segment.label ? ` · ${segment.label}` : ""}`;
        const color = muted ? "bg-zinc-700 text-zinc-300" : TIMELINE_COLORS[segment.type];

        return (
          <div
            key={`${segment.type}:${segment.startMs}:${segment.endMs}:${segment.label}`}
            className={`h-full shrink-0 ${color} ${index === 0 ? "rounded-l-md" : ""} ${
              index === normalized.length - 1 ? "rounded-r-md" : ""
            }`}
            style={{ width: `${Math.max(0, widthPct)}%` }}
            title={title}
          />
        );
      })}
    </div>
  );
}
