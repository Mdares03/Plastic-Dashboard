"use client";

import type { RecapTimelineSegment } from "@/lib/recap/types";
import {
  computeWidths,
  formatDuration,
  formatTime,
  LABEL_MIN_WIDTH_PCT,
  normalizeTimelineSegments,
  TIMELINE_COLORS,
} from "@/components/recap/timelineRender";
import { useI18n } from "@/lib/i18n/useI18n";

type Props = {
  rangeStart: string;
  rangeEnd: string;
  segments: RecapTimelineSegment[];
  locale: string;
  hasData?: boolean;
};

const MIN_SEGMENT_PCT = 1.5;

export default function RecapFullTimeline({ rangeStart, rangeEnd, segments, locale, hasData = true }: Props) {
  const { t } = useI18n();
  const startMs = new Date(rangeStart).getTime();
  const endMs = new Date(rangeEnd).getTime();
  const totalMs = Math.max(1, endMs - startMs);

  const normalized = normalizeTimelineSegments(segments, startMs, endMs);
  const widths = computeWidths(normalized, totalMs, MIN_SEGMENT_PCT);

  return (
    <div className="rounded-2xl border border-white/10 bg-black/40 p-4">
      <div className="mb-3 text-sm font-semibold text-white">{t("recap.timeline.title")}</div>
      {!hasData ? (
        <div className="rounded-xl border border-dashed border-white/10 bg-black/20 p-4 text-sm text-zinc-400">
          {t("recap.timeline.noData")}
        </div>
      ) : null}
      {hasData ? (
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
