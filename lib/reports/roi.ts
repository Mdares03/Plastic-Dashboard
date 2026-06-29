import { prisma } from "@/lib/prisma";
import { computeDowntime, resolveWindow } from "@/lib/metrics";
import { isInPlannedShift } from "@/lib/metrics/shift";
import type { ShiftPlanningContext } from "@/lib/metrics/shift";
import { loadShiftPlanningContext } from "@/lib/reports/queries/shiftPlanning";
import { getPlannedReasonCodes } from "@/lib/downtime/plannedCodes";
import { resolveCostPerMin } from "@/lib/financial/costPerMin";
import type { ReasonRow } from "@/lib/metrics/types";

/**
 * C2/C3 — ROI = downtime reduction × cost per stopped minute.
 *
 * The downtime number here is the SAME authority every screen uses (computeDowntime over
 * ReasonEntry, shift-aware), so the ROI the client sees is verifiable against the dashboard
 * (see docs/ROI_MODEL.md). Baseline and current periods are compared as minutes/day, so
 * windows of different lengths compare fairly.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TARGET_PCT = 20;

const REASON_SELECT = {
  kind: true,
  reasonCode: true,
  reasonLabel: true,
  durationSeconds: true,
  capturedAt: true,
  episodeEndTs: true,
  scrapQty: true,
  workOrderId: true,
} as const;

type ReasonDbRow = {
  kind: string;
  reasonCode: string;
  reasonLabel: string | null;
  durationSeconds: number | null;
  capturedAt: Date;
  episodeEndTs: Date | null;
  scrapQty: number | null;
  workOrderId: string | null;
};

export type RoiPeriod = {
  start: string;
  end: string;
  days: number;
  unplannedMin: number;
  unplannedMinPerDay: number;
};

export type RoiTrendBucket = { start: string; end: string; unplannedMinPerDay: number | null };

export type RoiResult = {
  baseline: RoiPeriod;
  current: RoiPeriod;
  targetReductionPct: number;
  /** (baselinePerDay − currentPerDay) / baselinePerDay, in %. Negative = downtime got worse. */
  achievedReductionPct: number | null;
  meetsTarget: boolean;
  costPerMin: number;
  /** Monthly (30-day) money saved at the current reduction and cost rate. */
  estimatedMonthlySavings: number;
  currency: string;
  /** True when cost rates are missing or still the 1/min placeholder — money is illustrative. */
  costRatesArePlaceholder: boolean;
  trend: RoiTrendBucket[];
};

function round1(v: number): number {
  return Math.round(v * 10) / 10;
}

function unplannedMinutes(
  rows: ReasonDbRow[],
  start: Date,
  end: Date,
  shiftCtx: ShiftPlanningContext,
  plannedCodes: Set<string>,
): number {
  const inShift = rows.filter((r) => isInPlannedShift(shiftCtx, r.capturedAt));
  const window = resolveWindow({ mode: "custom", timezone: shiftCtx.timeZone, start, end });
  return computeDowntime(inShift as ReasonRow[], window, plannedCodes).unplannedMin;
}

function toPeriod(
  rows: ReasonDbRow[],
  start: Date,
  end: Date,
  shiftCtx: ShiftPlanningContext,
  plannedCodes: Set<string>,
): RoiPeriod {
  const days = Math.max(1, (end.getTime() - start.getTime()) / DAY_MS);
  const unplannedMin = unplannedMinutes(rows, start, end, shiftCtx, plannedCodes);
  return {
    start: start.toISOString(),
    end: end.toISOString(),
    days: round1(days),
    unplannedMin: round1(unplannedMin),
    unplannedMinPerDay: round1(unplannedMin / days),
  };
}

function readRoiConfig(defaultsJson: unknown): { baselineStart?: Date; baselineEnd?: Date; targetReductionPct: number } {
  const root = defaultsJson && typeof defaultsJson === "object" ? (defaultsJson as Record<string, unknown>) : {};
  const roi = root.roi && typeof root.roi === "object" ? (root.roi as Record<string, unknown>) : {};
  const parseDate = (v: unknown) => {
    if (typeof v !== "string") return undefined;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? undefined : d;
  };
  const target = typeof roi.targetReductionPct === "number" && Number.isFinite(roi.targetReductionPct)
    ? roi.targetReductionPct
    : DEFAULT_TARGET_PCT;
  return { baselineStart: parseDate(roi.baselineStart), baselineEnd: parseDate(roi.baselineEnd), targetReductionPct: target };
}

export async function computeRoi(params: {
  orgId: string;
  machineId?: string | null;
  /** Current comparison window. Defaults to the last 30 days. */
  currentStart?: Date;
  currentEnd?: Date;
}): Promise<RoiResult> {
  const now = new Date();
  const currentEnd = params.currentEnd ?? now;
  const currentStart = params.currentStart ?? new Date(currentEnd.getTime() - 30 * DAY_MS);

  const [machines, settings, shiftCtx, cost, plannedCodes] = await Promise.all([
    prisma.machine.findMany({
      where: { orgId: params.orgId, ...(params.machineId ? { id: params.machineId } : {}) },
      select: { id: true },
    }),
    prisma.orgSettings.findUnique({
      where: { orgId: params.orgId },
      select: {
        defaultsJson: true,
        roiBaselineStart: true,
        roiBaselineEnd: true,
        roiTargetReductionPct: true,
      },
    }),
    loadShiftPlanningContext(params.orgId),
    resolveCostPerMin(params.orgId),
    getPlannedReasonCodes(params.orgId),
  ]);
  const machineIds = machines.map((m) => m.id);

  // Dedicated columns are authoritative; fall back to the legacy defaultsJson.roi blob.
  const legacy = readRoiConfig(settings?.defaultsJson);
  const cfg = {
    baselineStart: settings?.roiBaselineStart ?? legacy.baselineStart,
    baselineEnd: settings?.roiBaselineEnd ?? legacy.baselineEnd,
    targetReductionPct: settings?.roiTargetReductionPct ?? legacy.targetReductionPct,
  };
  // Baseline window: configured, else the 30 days immediately before the current window.
  const baselineEnd = cfg.baselineEnd ?? new Date(currentStart.getTime());
  const baselineStart = cfg.baselineStart ?? new Date(baselineEnd.getTime() - 30 * DAY_MS);

  // One fetch spanning baseline..current (whichever is earliest..latest), then slice.
  const fetchStart = baselineStart < currentStart ? baselineStart : currentStart;
  const fetchEnd = currentEnd > baselineEnd ? currentEnd : baselineEnd;

  const rows = machineIds.length
    ? ((await prisma.reasonEntry.findMany({
        where: {
          orgId: params.orgId,
          machineId: { in: machineIds },
          kind: "downtime",
          capturedAt: { gte: fetchStart, lte: fetchEnd },
        },
        select: REASON_SELECT,
      })) as ReasonDbRow[])
    : [];

  const baseline = toPeriod(rows, baselineStart, baselineEnd, shiftCtx, plannedCodes);
  const current = toPeriod(rows, currentStart, currentEnd, shiftCtx, plannedCodes);

  const achievedReductionPct =
    baseline.unplannedMinPerDay > 0
      ? round1(((baseline.unplannedMinPerDay - current.unplannedMinPerDay) / baseline.unplannedMinPerDay) * 100)
      : null;

  const minPerDaySaved = Math.max(0, baseline.unplannedMinPerDay - current.unplannedMinPerDay);
  const estimatedMonthlySavings = Math.round(minPerDaySaved * 30 * cost.costPerMin);

  // 90-day weekly trend of unplanned min/day, to show the improvement is sustained.
  const trend: RoiTrendBucket[] = [];
  const trendWeeks = 13;
  const trendRows = (await prisma.reasonEntry.findMany({
    where: {
      orgId: params.orgId,
      machineId: { in: machineIds.length ? machineIds : ["__none__"] },
      kind: "downtime",
      capturedAt: { gte: new Date(now.getTime() - trendWeeks * 7 * DAY_MS), lte: now },
    },
    select: REASON_SELECT,
  })) as ReasonDbRow[];
  for (let i = trendWeeks - 1; i >= 0; i -= 1) {
    const wEnd = new Date(now.getTime() - i * 7 * DAY_MS);
    const wStart = new Date(wEnd.getTime() - 7 * DAY_MS);
    const inWeek = trendRows.filter((r) => r.capturedAt >= wStart && r.capturedAt <= wEnd);
    const min = unplannedMinutes(inWeek, wStart, wEnd, shiftCtx, plannedCodes);
    trend.push({ start: wStart.toISOString(), end: wEnd.toISOString(), unplannedMinPerDay: round1(min / 7) });
  }

  return {
    baseline,
    current,
    targetReductionPct: cfg.targetReductionPct,
    achievedReductionPct,
    meetsTarget: achievedReductionPct != null && achievedReductionPct >= cfg.targetReductionPct,
    costPerMin: cost.costPerMin,
    estimatedMonthlySavings,
    currency: cost.currency,
    costRatesArePlaceholder: cost.placeholder,
    trend,
  };
}
