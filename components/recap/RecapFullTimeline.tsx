"use client";

import type { RecapRangeMode, RecapTimelineSegment } from "@/lib/recap/types";
import {
  computeWidths,
  formatDuration,
  formatTime,
  LABEL_MIN_WIDTH_PCT,
  normalizeTimelineSegments,
  SEGMENT_MIN_WIDTH_PCT,
  TIMELINE_COLORS,
} from "@/components/recap/timelineRender";
import { useI18n } from "@/lib/i18n/useI18n";

type Props = {
  rangeStart: string;
  rangeEnd: string;
  segments: RecapTimelineSegment[];
  locale: string;
  hasData?: boolean;
  loading?: boolean;
  rangeMode?: RecapRangeMode;
};

export default function RecapFullTimeline({
  rangeStart,
  rangeEnd,
  segments,
  locale,
  hasData = false,
  loading = false,
  rangeMode,
}: Props) {
  const { t } = useI18n();
  const startMs = new Date(rangeStart).getTime();
  const endMs = new Date(rangeEnd).getTime();
  const totalMs = Math.max(1, endMs - startMs);

  const normalized = hasData ? normalizeTimelineSegments(segments, startMs, endMs) : [];
  const widths = computeWidths(normalized, totalMs, SEGMENT_MIN_WIDTH_PCT);
  const rangeSuffix =
    rangeMode === "shift"
      ? t("recap.range.shiftCurrent")
      : rangeMode === "yesterday"
        ? t("recap.range.yesterday")
        : rangeMode === "custom"
          ? t("recap.range.custom")
          : t("recap.range.24h");
  const titleText = `${t("recap.timeline.title")} · ${rangeSuffix}`;

  return (
    <div className="rounded-2xl border border-white/10 bg-black/40 p-4">
      <div className="mb-3 text-sm font-semibold text-white">{titleText}</div>
      {loading ? (
        <div className="overflow-x-auto">
          <div className="min-w-[560px]">
            <div className="flex h-14 w-full animate-pulse overflow-hidden rounded-xl bg-white/5">
              <div className="h-full w-[12%] bg-zinc-700/70" />
              <div className="h-full w-[8%] bg-orange-500/60" />
              <div className="h-full w-[14%] bg-zinc-700/70" />
              <div className="h-full w-[7%] bg-red-500/60" />
              <div className="h-full w-[59%] bg-zinc-700/70" />
            </div>
          </div>
        </div>
      ) : null}
      {!loading && !hasData ? (
        <div className="rounded-xl border border-dashed border-white/10 bg-black/20 p-4 text-sm text-zinc-400">
          {t("recap.timeline.noData")}
        </div>
      ) : null}
      {!loading && hasData ? (
        <div className="overflow-x-auto">
          <div className="min-w-[560px]">
            <div className="flex h-14 w-full overflow-hidden rounded-xl">
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
                const title = `${typeLabel} · ${formatTime(segment.startMs, locale)}-${formatTime(
                  segment.endMs,
                  locale
                )} · ${formatDuration(segment.startMs, segment.endMs)}${segment.label ? ` · ${segment.label}` : ""}`;

                return (
                  <div
                    key={`${segment.type}:${segment.startMs}:${segment.endMs}:${segment.label}`}
                    className={`flex h-full shrink-0 items-center justify-center truncate px-2 text-xs font-semibold ${
                      TIMELINE_COLORS[segment.type]
                    } ${index === 0 ? "rounded-l-xl" : ""} ${
                      index === normalized.length - 1 ? "rounded-r-xl" : ""
                    }`}
                    style={{ width: `${Math.max(0, widthPct)}%` }}
                    title={title}
                  >
                    {widthPct > LABEL_MIN_WIDTH_PCT ? segment.label : ""}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
