Filter context noted: turno actual + ayer both flow through resolveDetailRange → getRecapDataCached → same loadWorkOrderCounterRows lifetime bug. Patch 1 below fixes lifetime numbers across all filter modes. The "Timeline 24h" label is hardcoded i18n key recap.timeline.title regardless of selected range — separate cosmetic bug. Patch list at end.

PATCH 1 — Window-scoped SKU + production totals
File: lib/recap/getRecapData.ts
Replaces: lines ~642–678 (the for (const row of machineWorkOrderCounters) loop, the openWorkOrders ensure loop, and the latestTelemetry ensure block)
BEFORE:
ts    for (const row of machineWorkOrderCounters) {
      const safeGood = Math.max(0, Math.trunc(safeNum(row.goodParts) ?? 0));
      const safeScrap = Math.max(0, Math.trunc(safeNum(row.scrapParts) ?? 0));
      const safeCycleCount = Math.max(0, Math.trunc(safeNum(row.cycleCount) ?? 0));
      const target = safeNum(row.targetQty);

      const skuAgg = ensureAuthoritativeSku(row.sku, target, false);
      skuAgg.good += safeGood;
      skuAgg.scrap += safeScrap;

      goodParts += safeGood;
      scrapParts += safeScrap;
      authoritativeCycleCount += safeCycleCount;

      const woKey = workOrderKey(row.workOrderId);
      if (!woKey) continue;
      const progress = authoritativeWorkOrderProgress.get(woKey) ?? {
        goodParts: 0,
        scrapParts: 0,
        cycleCount: 0,
        firstTs: null,
        lastTs: null,
      };
      progress.goodParts += safeGood;
      progress.scrapParts += safeScrap;
      progress.cycleCount += safeCycleCount;
      if (!progress.firstTs || row.createdAt < progress.firstTs) progress.firstTs = row.createdAt;
      if (!progress.lastTs || row.updatedAt > progress.lastTs) progress.lastTs = row.updatedAt;
      authoritativeWorkOrderProgress.set(woKey, progress);
    }

    for (const wo of openWorkOrders) {
      ensureAuthoritativeSku(normalizeToken(wo.sku) || null);
    }
    if (latestTelemetry?.sku) {
      ensureAuthoritativeSku(latestTelemetry.sku);
    }
AFTER:
ts    // Step 1: WO-level LIFETIME progress map.
    // Used downstream for completed-WO totals (goodParts/durationHrs) and active-WO progressPct,
    // both of which intentionally want lifetime, not window-scoped, values.
    for (const row of machineWorkOrderCounters) {
      const safeGood = Math.max(0, Math.trunc(safeNum(row.goodParts) ?? 0));
      const safeScrap = Math.max(0, Math.trunc(safeNum(row.scrapParts) ?? 0));
      const safeCycleCount = Math.max(0, Math.trunc(safeNum(row.cycleCount) ?? 0));
      const woKey = workOrderKey(row.workOrderId);
      if (!woKey) continue;
      const progress = authoritativeWorkOrderProgress.get(woKey) ?? {
        goodParts: 0,
        scrapParts: 0,
        cycleCount: 0,
        firstTs: null,
        lastTs: null,
      };
      progress.goodParts += safeGood;
      progress.scrapParts += safeScrap;
      progress.cycleCount += safeCycleCount;
      if (!progress.firstTs || row.createdAt < progress.firstTs) progress.firstTs = row.createdAt;
      if (!progress.lastTs || row.updatedAt > progress.lastTs) progress.lastTs = row.updatedAt;
      authoritativeWorkOrderProgress.set(woKey, progress);
    }

    // Step 2: WINDOW-SCOPED production totals + per-SKU breakdown from in-window cycle deltas.
    // dedupedCycles is already filtered by ts >= start && ts <= end at the Prisma query level.
    // Each cycle row contributes its own goodDelta/scrapDelta to the SKU it belongs to.
    for (const cycle of dedupedCycles) {
      const skuRaw = normalizeToken(cycle.sku);
      const g = Math.max(0, Math.trunc(safeNum(cycle.goodDelta) ?? 0));
      const s = Math.max(0, Math.trunc(safeNum(cycle.scrapDelta) ?? 0));
      // Count the cycle row toward total cycles regardless of SKU (timing-only cycles still happened).
      authoritativeCycleCount += 1;
      if (g === 0 && s === 0) continue; // no production to attribute
      goodParts += g;
      scrapParts += s;
      if (!skuRaw) continue; // production exists but no SKU tag — count totals, skip SKU table row
      const skuAgg = ensureAuthoritativeSku(skuRaw, null, true);
      skuAgg.good += g;
      skuAgg.scrap += s;
    }
What changes for the user:

BUENAS / SCRAP / SKU table = in-window only
Empty SKUs (open WOs that produced nothing in window, latest telemetry SKU) no longer pad the table
Completed WO list, active WO progress%, mold change logic = unchanged (still use lifetime via authoritativeWorkOrderProgress)


PATCH 2 — Unify machine-detail timeline range to 24h
File: app/(app)/machines/[machineId]/MachineDetailClient.tsx
Change 1 — function rename + range: find getMinuteFlooredOneHourRange (around line 365–373):
BEFORE:
tsfunction getMinuteFlooredOneHourRange() {
  const endMs = Math.floor(Date.now() / 60000) * 60000;
  return {
    startMs: endMs - 60 * 60 * 1000,
    endMs,
  };
}
AFTER:
tsfunction getMinuteFlooredDefaultRange() {
  const endMs = Math.floor(Date.now() / 60000) * 60000;
  return {
    startMs: endMs - 24 * 60 * 60 * 1000,
    endMs,
  };
}
Change 2 — call sites: there are two of them in MachineActivityTimeline (line ~388 inside loadTimeline, line ~427 for the fallback). Replace both:
BEFORE:
tsconst range = getMinuteFlooredOneHourRange();
tsconst fallbackRange = getMinuteFlooredOneHourRange();
AFTER:
tsconst range = getMinuteFlooredDefaultRange();
tsconst fallbackRange = getMinuteFlooredDefaultRange();
Change 3 — UI label: line ~447:
BEFORE:
tsx<div className="text-xs text-zinc-400">1h</div>
AFTER:
tsx<div className="text-xs text-zinc-400">24h</div>
After this, machine detail timeline = same backend, same range, same input as recap detail timeline → identical content (modulo cache age).




PATCH 3 — Dynamic timeline title that reflects the active filter
Reuses existing recap.range.* translation keys. No i18n file changes needed.
File A: components/recap/RecapFullTimeline.tsx
Change 1 — imports + type:
BEFORE (lines 1–22):
tsx"use client";

import type { RecapTimelineSegment } from "@/lib/recap/types";
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
};
AFTER:
tsx"use client";

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
Change 2 — destructure prop + render dynamic title:
BEFORE (lines 24–42):
tsxexport default function RecapFullTimeline({
  rangeStart,
  rangeEnd,
  segments,
  locale,
  hasData = false,
  loading = false,
}: Props) {
  const { t } = useI18n();
  const startMs = new Date(rangeStart).getTime();
  const endMs = new Date(rangeEnd).getTime();
  const totalMs = Math.max(1, endMs - startMs);

  const normalized = hasData ? normalizeTimelineSegments(segments, startMs, endMs) : [];
  const widths = computeWidths(normalized, totalMs, SEGMENT_MIN_WIDTH_PCT);

  return (
    <div className="rounded-2xl border border-white/10 bg-black/40 p-4">
      <div className="mb-3 text-sm font-semibold text-white">{t("recap.timeline.title")}</div>
AFTER:
tsxexport default function RecapFullTimeline({
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
File B: app/(app)/recap/[machineId]/RecapDetailClient.tsx
BEFORE (around lines 215–222):
tsx        <RecapFullTimeline
          rangeStart={timelineStart}
          rangeEnd={timelineEnd}
          segments={timelineSegments}
          hasData={timelineHasData}
          loading={timelineLoading}
          locale={locale}
        />
AFTER:
tsx        <RecapFullTimeline
          rangeStart={timelineStart}
          rangeEnd={timelineEnd}
          segments={timelineSegments}
          hasData={timelineHasData}
          loading={timelineLoading}
          locale={locale}
          rangeMode={initialData.range.mode}
        />
Optional bonus — change i18n value: lib/i18n/es-MX.json and lib/i18n/en.json, find key recap.timeline.title and change value from "Timeline 24h" (or whatever it currently is) to just "Timeline". The dynamic suffix will append the actual range. If you don't strip the "24h" from the value, the title will read "Timeline 24h · Ayer" when ayer is selected — still better than current, but cleaner if stripped.