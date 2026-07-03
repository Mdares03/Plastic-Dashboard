"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import ReclassifyModal, { type ReclassifyTarget } from "@/components/downtime/ReclassifyModal";
import KpiTile from "@/components/kpi/KpiTile";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useI18n } from "@/lib/i18n/useI18n";
import { formatElapsedFromMinutes } from "@/lib/time/elapsed";
import { computeSavingsByReason } from "@/lib/analytics/savingsByReason";
import { SlidersHorizontal } from "lucide-react";
import dynamic from "next/dynamic";
import ChartSkeleton from "@/components/charts/ChartSkeleton";

// Recharts is heavy; code-split the Pareto hero so it loads only on this page.
const DowntimeParetoHero = dynamic(() => import("@/components/downtime/DowntimeParetoHero"), {
  ssr: false,
  loading: () => <ChartSkeleton heightClass="h-full" />,
});

/**
 * API SHAPES (from your route.ts)
 */
type ApiParetoRow = {
  reasonCode: string;
  reasonLabel: string;
  minutesLost?: number;
  scrapQty?: number;
  pctOfTotal: number; // percent 0..100
  cumulativePct: number; // percent 0..100
  count: number;
};

type ApiParetoRes = {
  ok: boolean;
  excludeUnclassified?: boolean;
  totalMinutesAll?: number;
  totalMinutesClassified?: number;
  excludedUnclassifiedMinutes?: number;
  excludedUnclassifiedPct?: number;
  error?: string;
  orgId?: string;
  machineId?: string | null;
  kind?: "downtime" | "scrap";
  range?: "24h" | "7d" | "30d";
  start?: string;
  totalMinutesLost?: number;
  totalScrap?: number;
  rows?: ApiParetoRow[];
  top3?: ApiParetoRow[];
  threshold80?: { index: number; reasonCode: string; reasonLabel: string } | null;
  total?: number;
};

type LegacyParetoItem = {
  reasonCode?: string;
  reasonLabel?: string;
  value?: number; // minutes (downtime) or qty (scrap)
  count?: number;
  cumPct?: number;
};

type ApiDowntimeEvent = {
  id: string;
  episodeId: string | null;
  machineId: string;
  machineName: string | null;

  reasonCode: string;
  reasonLabel: string;
  reasonText: string | null;

  durationSeconds: number | null;
  durationMinutes: number | null;

  startAt: string | null;
  endAt: string | null;
  capturedAt: string | null;

  workOrderId: string | null;
  meta: any | null;
  createdAt: string | null;
};

type ApiDowntimeEventsRes = {
  ok: boolean;
  excludeUnclassified?: boolean;
  totalEventsAll?: number;
  totalEventsClassified?: number;
  excludedUnclassifiedEvents?: number;
  excludedUnclassifiedPct?: number;
  totalMinutesAll?: number;
  totalMinutesClassified?: number;
  excludedUnclassifiedMinutes?: number;
  error?: string;
  orgId?: string;
  range?: "24h" | "7d" | "30d";
  start?: string;
  machineId?: string | null;
  reasonCode?: string | null;
  limit?: number;
  before?: string | null;
  nextBefore?: string | null;
  events?: ApiDowntimeEvent[];
};

type ApiReasonCatalogRow = {
  kind: "downtime" | "scrap";
  categoryId: string;
  categoryLabel: string;
  detailId: string;
  detailLabel: string;
  reasonCode: string;
  reasonLabel: string;
};

type ApiReasonCatalogRes = {
  ok: boolean;
  error?: string;
  kind?: "downtime" | "scrap";
  catalogVersion?: number;
  rows?: ApiReasonCatalogRow[];
};

type ApiMachineRow = { id: string; name: string | null };

function fmtDT(iso: string | null, locale?: string) {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString(locale ?? "en-US", { hour12: true });
}

function normalizeParetoRes(input: ApiParetoRes): ApiParetoRes {
  const rows = Array.isArray(input?.rows) ? input.rows : [];
  if (rows.length > 0) return input;

  // Support a legacy envelope where the server returns `items[]` instead of `rows[]`.
  const legacyItems = (input as any)?.items as unknown;
  if (!Array.isArray(legacyItems) || legacyItems.length === 0) return input;

  const items = legacyItems as LegacyParetoItem[];
  const safeItems = items
    .map((it) => ({
      reasonCode: String(it?.reasonCode ?? "").trim(),
      reasonLabel: String(it?.reasonLabel ?? it?.reasonCode ?? "").trim(),
      value: typeof it?.value === "number" && Number.isFinite(it.value) ? it.value : 0,
      count: typeof it?.count === "number" && Number.isFinite(it.count) ? it.count : 0,
    }))
    .filter((x) => x.reasonCode);

  // Legacy `items` are usually pre-sorted by value desc; enforce it anyway.
  safeItems.sort((a, b) => b.value - a.value);

  const total = safeItems.reduce((acc, x) => acc + x.value, 0);
  let cum = 0;
  let threshold80Index: number | null = null;

  const outRows: ApiParetoRow[] = safeItems.map((x, idx) => {
    const pctOfTotal = total > 0 ? (x.value / total) * 100 : 0;
    cum += x.value;
    const cumulativePct = total > 0 ? (cum / total) * 100 : 0;
    if (threshold80Index === null && cumulativePct >= 80) threshold80Index = idx;

    return {
      reasonCode: x.reasonCode,
      reasonLabel: x.reasonLabel || x.reasonCode,
      minutesLost: input.kind === "scrap" ? undefined : x.value,
      scrapQty: input.kind === "scrap" ? x.value : undefined,
      pctOfTotal,
      cumulativePct,
      count: x.count,
    };
  });

  const threshold80 =
    threshold80Index === null
      ? null
      : {
          index: threshold80Index,
          reasonCode: outRows[threshold80Index].reasonCode,
          reasonLabel: outRows[threshold80Index].reasonLabel,
        };

  return {
    ...input,
    rows: outRows,
    top3: outRows.slice(0, 3),
    threshold80,
    totalMinutesLost: input.kind === "scrap" ? undefined : total,
    totalScrap: input.kind === "scrap" ? total : undefined,
    total,
  };
}

function buildParetoFromEvents(events: ApiDowntimeEvent[]): ApiParetoRes | null {
  if (!Array.isArray(events) || events.length === 0) return null;

  const byCode = new Map<
    string,
    { reasonCode: string; reasonLabel: string; minutes: number; count: number }
  >();

  for (const e of events) {
    const reasonCode = String(e?.reasonCode ?? "").trim();
    if (!reasonCode) continue;
    const reasonLabel = String(e?.reasonLabel ?? reasonCode).trim() || reasonCode;
    const minutes =
      (typeof e?.durationMinutes === "number" && Number.isFinite(e.durationMinutes)
        ? e.durationMinutes
        : null) ??
      (typeof e?.durationSeconds === "number" && Number.isFinite(e.durationSeconds)
        ? e.durationSeconds / 60
        : 0);

    const slot =
      byCode.get(reasonCode) ?? { reasonCode, reasonLabel, minutes: 0, count: 0 };
    slot.minutes += Math.max(0, minutes);
    slot.count += 1;
    // prefer the most recent non-empty label if they differ
    if (reasonLabel && reasonLabel !== reasonCode) slot.reasonLabel = reasonLabel;
    byCode.set(reasonCode, slot);
  }

  const items = [...byCode.values()].filter((x) => x.minutes > 0 || x.count > 0);
  items.sort((a, b) => b.minutes - a.minutes);

  const totalMinutesLost = items.reduce((acc, x) => acc + x.minutes, 0);
  let cum = 0;
  let threshold80Index: number | null = null;

  const rows: ApiParetoRow[] = items.map((x, idx) => {
    const pctOfTotal = totalMinutesLost > 0 ? (x.minutes / totalMinutesLost) * 100 : 0;
    cum += x.minutes;
    const cumulativePct = totalMinutesLost > 0 ? (cum / totalMinutesLost) * 100 : 0;
    if (threshold80Index === null && cumulativePct >= 80) threshold80Index = idx;
    return {
      reasonCode: x.reasonCode,
      reasonLabel: x.reasonLabel,
      minutesLost: Math.round(x.minutes * 10) / 10,
      pctOfTotal,
      cumulativePct,
      count: x.count,
    };
  });

  const threshold80 =
    threshold80Index === null
      ? null
      : {
          index: threshold80Index,
          reasonCode: rows[threshold80Index].reasonCode,
          reasonLabel: rows[threshold80Index].reasonLabel,
        };

  return {
    ok: true,
    kind: "downtime",
    totalMinutesLost: Math.round(totalMinutesLost * 10) / 10,
    rows,
    top3: rows.slice(0, 3),
    threshold80,
    total: totalMinutesLost,
  };
}


type Range = "24h" | "7d" | "30d";
type Metric = "minutes" | "count";
type DowntimeView = "overview" | "events";

type MetricRow = {
  reasonCode: string;
  reasonLabel: string;
  value: number; // minutes OR count
  count: number; // always count (stops)
  pctOfTotal: number; // percent 0..100 in selected metric
  cumulativePct: number; // percent 0..100 in selected metric
  minutesLost?: number; // if available
};

function fmtNum(n: number, digits = 0) {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(n);
}

function fmtPct(pct: number, digits = 0) {
  return `${fmtNum(pct, digits)}%`;
}

function fmtDurationFromMinutes(min: number | null | undefined) {
  return formatElapsedFromMinutes(min, { maxUnits: 2 });
}

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function buildSearch(params: URLSearchParams, patch: Record<string, string | null>) {
  const next = new URLSearchParams(params.toString());
  Object.entries(patch).forEach(([k, v]) => {
    if (v === null) next.delete(k);
    else next.set(k, v);
  });
  return next.toString();
}

/**
 * Derive a Pareto set for Minutes or Count from the same API response.
 * - Your API always returns rows sorted by VALUE (minutes for downtime, scrapQty for scrap).
 * - For Metric=COUNT, we re-sort by count and recompute pct/cum on client.
 */
function computeMetricRows(base: ApiParetoRow[], metric: Metric): MetricRow[] {
  const safe = base ?? [];

  if (metric === "minutes") {
    const rows: MetricRow[] = safe.map((r) => ({
      reasonCode: r.reasonCode,
      reasonLabel: r.reasonLabel,
      value: r.minutesLost ?? 0,
      count: r.count ?? 0,
      pctOfTotal: r.pctOfTotal ?? 0,
      cumulativePct: r.cumulativePct ?? 0,
      minutesLost: r.minutesLost ?? 0,
    }));
    return rows;
  }

  // metric === "count"
  const sorted = [...safe].sort((a, b) => (b.count ?? 0) - (a.count ?? 0));
  const total = sorted.reduce((acc, r) => acc + (r.count ?? 0), 0);

  let cum = 0;
  const out: MetricRow[] = sorted.map((r) => {
    const v = r.count ?? 0;
    const pct = total > 0 ? (v / total) * 100 : 0;
    cum += v;
    const cumPct = total > 0 ? (cum / total) * 100 : 0;

    return {
      reasonCode: r.reasonCode,
      reasonLabel: r.reasonLabel,
      value: v,
      count: v,
      pctOfTotal: pct,
      cumulativePct: cumPct,
      minutesLost: r.minutesLost ?? 0,
    };
  });

  return out;
}

/**
 * Right-side drawer (reason detail) — the at-a-glance stats for the selected
 * reason. Trimmed to the numbers it can defend (downtime, share, stops, avg);
 * a richer per-reason events view is a separate enhancement.
 */
function ReasonDrawer({
  open,
  onClose,
  row,
  metric,
}: {
  open: boolean;
  onClose: () => void;
  row: MetricRow | null;
  metric: Metric;
}) {
  const { t } = useI18n();
  if (!open || !row) return null;

  const avgMin =
    row.count > 0 && row.minutesLost != null ? row.minutesLost / row.count : null;

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="absolute right-0 top-0 h-full w-full max-w-[520px] overflow-hidden border-l border-white/10 bg-zinc-950/70 backdrop-blur-xl">
        <div
          className="pointer-events-none absolute inset-0 opacity-70"
          style={{
            background:
              "radial-gradient(900px 500px at 20% 10%, rgba(16,185,129,.18), transparent 60%)," +
              "radial-gradient(900px 500px at 85% 30%, rgba(59,130,246,.12), transparent 60%)," +
              "radial-gradient(900px 600px at 50% 100%, rgba(244,63,94,.10), transparent 60%)",
          }}
        />
        <div className="relative flex h-full flex-col">
          <div className="flex items-start justify-between gap-3 border-b border-white/10 p-5">
            <div className="min-w-0">
              <div className="text-sm font-semibold text-white">{t("downtime.drawer.title")}</div>
              <div className="mt-1 truncate text-xs text-zinc-300">{row.reasonLabel}</div>
            </div>
            <button
              onClick={onClose}
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white hover:bg-white/10"
            >
              {t("common.close")}
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-5 no-scrollbar">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="text-xs text-zinc-300">
                  {metric === "minutes" ? t("downtime.metric.downtime") : t("downtime.metric.stops")}
                </div>
                <div className="mt-2 text-2xl font-semibold text-white">
                  {metric === "minutes" ? fmtDurationFromMinutes(row.value) : fmtNum(row.value, 0)}
                </div>
                <div className="mt-1 text-xs text-zinc-300">{t("downtime.drawer.share", { pct: fmtPct(row.pctOfTotal, 1) })}</div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="text-xs text-zinc-300">{t("downtime.metric.stops")}</div>
                <div className="mt-2 text-2xl font-semibold text-white">{fmtNum(row.count, 0)}</div>
                <div className="mt-1 text-xs text-zinc-300">
                  {avgMin == null ? t("downtime.drawer.avgNone") : t("downtime.drawer.avg", { v: fmtDurationFromMinutes(avgMin) })}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function nextHourBoundary(d: Date) {
  const x = new Date(d);
  x.setMinutes(0, 0, 0);
  x.setHours(x.getHours() + 1);
  return x;
}

function getEventInterval(e: ApiDowntimeEvent): { start: Date | null; end: Date | null } {
  const startIso = e.startAt ?? e.capturedAt;
  if (!startIso) return { start: null, end: null };

  const start = new Date(startIso);
  if (Number.isNaN(start.getTime())) return { start: null, end: null };

  // Prefer endAt if present
  if (e.endAt) {
    const end = new Date(e.endAt);
    if (!Number.isNaN(end.getTime()) && end > start) return { start, end };
  }

  // Fall back to duration fields
  const durMin =
    e.durationMinutes ??
    (e.durationSeconds != null ? e.durationSeconds / 60 : null);

  if (durMin != null && durMin > 0) {
    const end = new Date(start.getTime() + durMin * 60_000);
    return { start, end };
  }

  return { start, end: null };
}

/**
 * Build heatmap matrix [7 days][24 hours]
 * - metric="minutes": distributes duration across hour buckets (accurate)
 * - metric="count": increments the start hour bucket
 */
function buildHeatmapMatrix(events: ApiDowntimeEvent[], metric: Metric) {
  const m = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));

  for (const e of events) {
    const { start, end } = getEventInterval(e);
    if (!start) continue;

    if (metric === "count") {
      m[start.getDay()][start.getHours()] += 1;
      continue;
    }

    if (!end) continue;

    let t = start;
    while (t < end) {
      const day = t.getDay();
      const hour = t.getHours();

      const boundary = nextHourBoundary(t);
      const segEnd = boundary < end ? boundary : end;
      const segMin = (segEnd.getTime() - t.getTime()) / 60_000;

      m[day][hour] += segMin;
      t = segEnd;
    }
  }

  let max = 0;
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) max = Math.max(max, m[d][h]);
  }

  return { matrix: m, max };
}

function eventTouchesSlot(e: ApiDowntimeEvent, slotDay: number, slotHour: number) {
  const { start, end } = getEventInterval(e);
  if (!start) return false;

  // Count metric: consider start bucket
  if (!end) return start.getDay() === slotDay && start.getHours() === slotHour;

  // Minutes metric: any overlap with that (day, hour) bucket
  let t = start;
  while (t < end) {
    if (t.getDay() === slotDay && t.getHours() === slotHour) return true;
    const boundary = nextHourBoundary(t);
    t = boundary < end ? boundary : end;
  }
  return false;
}

function heatColor(v: number, metric: Metric) {
  // "Good" = green even when v=0
  if (v <= 0) return { bg: "rgba(34,197,94,0.18)", label: "Good" };

  if (metric === "minutes") {
    // per-hour downtime minutes severity
    if (v < 2)  return { bg: "rgba(34,197,94,0.45)", label: "Low" };
    if (v < 6)  return { bg: "rgba(234,179,8,0.55)", label: "Watch" };   // yellow
    if (v < 15) return { bg: "rgba(249,115,22,0.65)", label: "High" };    // orange
    return        { bg: "rgba(239,68,68,0.75)", label: "Critical" };      // red
  }

  // metric === "count"
  if (v <= 1) return { bg: "rgba(34,197,94,0.45)", label: "Low" };
  if (v <= 3) return { bg: "rgba(234,179,8,0.55)", label: "Watch" };
  if (v <= 6) return { bg: "rgba(249,115,22,0.65)", label: "High" };
  return        { bg: "rgba(239,68,68,0.75)", label: "Critical" };
}

function Heatmap({
  events,
  metric,
  selected,
  onSelect,
  onClear,
}: {
  events: ApiDowntimeEvent[];
  metric: Metric;
  selected: { day: number; hour: number } | null;
  onSelect: (day: number, hour: number) => void;
  onClear: () => void;
}) {
  const { t } = useI18n();
  const { matrix, max } = useMemo(() => buildHeatmapMatrix(events, metric), [events, metric]);

  const dayLabels = [
    t("downtime.day.sun"), t("downtime.day.mon"), t("downtime.day.tue"), t("downtime.day.wed"),
    t("downtime.day.thu"), t("downtime.day.fri"), t("downtime.day.sat"),
  ];
  const sevLabel = (key: string) => t(`downtime.sev.${key.toLowerCase()}`);

  const hourLabels = Array.from({ length: 24 }, (_, h) =>
    h % 2 === 0 ? String(h).padStart(2, "0") : ""
  );

  const hasData = max > 0;

  return (
    <div className="mt-4 overflow-x-auto rounded-2xl border border-white/10 bg-black/20 p-3">
      <div className="min-w-[860px]">
        <div className="flex items-center justify-between pb-3">
          <div className="text-[11px] text-zinc-400">
            {t("downtime.heatmap.clickHint")}
          </div>
          {selected ? (
            <button
              onClick={onClear}
              className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-zinc-200 hover:bg-white/10"
            >
              {t("downtime.heatmap.clear")}
            </button>
          ) : null}
        </div>

        {/* Header row */}
        <div className="grid" style={{ gridTemplateColumns: "56px repeat(24, 28px)" }}>
          <div />
          {hourLabels.map((label, h) => (
            <div key={h} className="pb-2 text-center text-[10px] text-zinc-400">
              {label}
            </div>
          ))}
        </div>

        {/* Rows */}
        {matrix.map((row, dayIdx) => (
          <div
            key={dayIdx}
            className="grid items-center"
            style={{ gridTemplateColumns: "56px repeat(24, 28px)" }}
          >
            <div className="pr-2 text-right text-[11px] text-zinc-400">
              {dayLabels[dayIdx]}
            </div>

            {row.map((v, hour) => {
              const c = heatColor(v, metric);
              const isSelected = selected?.day === dayIdx && selected?.hour === hour;

              const title = `${dayLabels[dayIdx]} ${String(hour).padStart(2, "0")}:00–${String(
                (hour + 1) % 24
              ).padStart(2, "0")}:00\n${
                metric === "minutes" ? fmtDurationFromMinutes(v) : t("downtime.heatmap.stops", { n: fmtNum(v, 0) })
              }\n${sevLabel(c.label)}`;

              return (
                <button
                  key={hour}
                  title={title}
                  onClick={() => onSelect(dayIdx, hour)}
                  className={cn(
                    "h-[22px] w-[22px] rounded-md border border-white/5 transition",
                    "hover:brightness-110",
                    isSelected && "ring-2 ring-emerald-400/60"
                  )}
                  style={{
                    background: c.bg,
                    boxShadow: isSelected ? "0 0 0 1px rgba(16,185,129,0.35)" : undefined,
                  }}
                />
              );
            })}
          </div>
        ))}

        {/* Legend */}
        <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-zinc-400">
          <div className="inline-flex items-center gap-2">
            <span className="h-3 w-3 rounded-sm" style={{ background: "rgba(34,197,94,0.18)" }} />
            {t("downtime.sev.good")}
          </div>
          <div className="inline-flex items-center gap-2">
            <span className="h-3 w-3 rounded-sm" style={{ background: "rgba(234,179,8,0.55)" }} />
            {t("downtime.sev.watch")}
          </div>
          <div className="inline-flex items-center gap-2">
            <span className="h-3 w-3 rounded-sm" style={{ background: "rgba(249,115,22,0.65)" }} />
            {t("downtime.sev.high")}
          </div>
          <div className="inline-flex items-center gap-2">
            <span className="h-3 w-3 rounded-sm" style={{ background: "rgba(239,68,68,0.75)" }} />
            {t("downtime.sev.critical")}
          </div>

          <div className="ml-auto">
            {events.length === 0
              ? t("downtime.heatmap.noEvents")
              : hasData
              ? t("downtime.heatmap.maxCell", { v: metric === "minutes" ? fmtDurationFromMinutes(max) : t("downtime.heatmap.stops", { n: fmtNum(max, 0) }) })
              : t("downtime.heatmap.noDurations")}
          </div>
        </div>
      </div>
    </div>
  );
}

function isValidNum(x: any) {
  const n = Number(x);
  return Number.isFinite(n);
}

export default function DowntimePageClient() {
  const { t, locale } = useI18n();
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  // URL-backed filters
  const range = (sp.get("range") as Range) || "30d";
  const machineId = sp.get("machineId") || null;
  const view = ((sp.get("view") as DowntimeView) || "overview") as DowntimeView;

  // client-only filters (shareable)
  const metric = ((sp.get("metric") as Metric) || "minutes") as Metric;
  const reasonCode = sp.get("reasonCode") || null;
  const shift = (sp.get("shift") || "all").toUpperCase();
  const planned = (sp.get("planned") as "all" | "planned" | "unplanned") || "all";
  const microstopLtMin = sp.get("microstopLtMin") || "2";
  const excludeUnclassified = sp.get("excludeUnclassified") === "1";

  const hmDay = sp.get("hmDay");
  const hmHour = sp.get("hmHour");

  const heatmapSel =
    hmDay != null && hmHour != null && isValidNum(hmDay) && isValidNum(hmHour)
      ? { day: Number(hmDay), hour: Number(hmHour) }
      : null;

  const [pareto, setPareto] = useState<ApiParetoRes | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [eventsRes, setEventsRes] = useState<ApiDowntimeEventsRes | null>(null);
  const [eventsLoading, setEventsLoading] = useState(false);
  const [eventsErr, setEventsErr] = useState<string | null>(null);
  // B3 — web reclassification: which episode is open in the modal, and a nonce to
  // re-fetch events after a successful reclassify.
  const [reclassifyTarget, setReclassifyTarget] = useState<ReclassifyTarget | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [catalogRows, setCatalogRows] = useState<ApiReasonCatalogRow[]>([]);
  const [catalogErr, setCatalogErr] = useState<string | null>(null);

  const [eventsLimit, setEventsLimit] = useState<number>(200);
  const [eventsBefore, setEventsBefore] = useState<string | null>(null);

  // simple client filter (fast): text search on machine/reason/wo
  const [eventSearch, setEventSearch] = useState("");

  // "More filters" expander + machine picker source.
  const [showFilters, setShowFilters] = useState(false);
  const [machines, setMachines] = useState<ApiMachineRow[]>([]);

  // Est. cost rate (loaded cost/min) sourced from the financial profile.
  const [costRate, setCostRate] = useState<{ costPerMin: number; currency: string; placeholder: boolean } | null>(null);

  // Drilldown table (full reason table) folded behind an expander in Overview.
  const [showFullTable, setShowFullTable] = useState(false);

  const [drawer, setDrawer] = useState<{ open: boolean; row: MetricRow | null }>({
    open: false,
    row: null,
  });

  function setParams(patch: Record<string, string | null>) {
    const next = buildSearch(sp, patch);
    router.replace(`${pathname}?${next}`, { scroll: false });
  }

  function fmtMoney(n: number, currency: string) {
    return new Intl.NumberFormat(locale === "es-MX" ? "es-MX" : "en-US", {
      style: "currency",
      currency: currency || "USD",
      maximumFractionDigits: 0,
    }).format(n);
  }

  // Fetch (pareto)
  useEffect(() => {
    let alive = true;
    const ac = new AbortController();

    async function run() {
      setLoading(true);
      setErr(null);

      try {
        const qs = new URLSearchParams();
        qs.set("kind", "downtime");
        qs.set("range", range);
        if (machineId) qs.set("machineId", machineId);
        qs.set("shift", shift);
        qs.set("planned", planned);
        qs.set("microstopLtMin", microstopLtMin);
        if (excludeUnclassified) qs.set("excludeUnclassified", "1");

        const r1 = await fetch(`/api/analytics/pareto?${qs.toString()}`, {
          cache: "no-cache",
          credentials: "include",
          signal: ac.signal,
        });
        const j1raw = (await r1.json().catch(() => ({}))) as ApiParetoRes;

        if (!alive) return;

        if (!r1.ok || j1raw.ok === false) {
          setErr(j1raw?.error ?? t("downtime.err.pareto"));
          setPareto(null);
          setLoading(false);
          return;
        }

        setPareto(normalizeParetoRes(j1raw));
        setLoading(false);
      } catch (e: any) {
        if (!alive) return;
        setErr(e?.message ?? t("common.networkError"));
        setLoading(false);
      }
    }

    run();
    return () => {
      alive = false;
      ac.abort();
    };
  }, [range, machineId, shift, planned, microstopLtMin, excludeUnclassified]);

  // Reason catalog (breakdown menu)
  useEffect(() => {
    let alive = true;
    const ac = new AbortController();

    async function run() {
      setCatalogErr(null);
      try {
        const res = await fetch("/api/reasons/catalog?kind=downtime", {
          cache: "no-cache",
          credentials: "include",
          signal: ac.signal,
        });
        const json = (await res.json().catch(() => ({}))) as ApiReasonCatalogRes;
        if (!alive) return;
        if (!res.ok || json.ok === false) {
          setCatalogRows([]);
          setCatalogErr(json.error ?? t("downtime.err.catalog"));
          return;
        }
        setCatalogRows(Array.isArray(json.rows) ? json.rows : []);
      } catch (err: unknown) {
        if (!alive) return;
        setCatalogRows([]);
        setCatalogErr(err instanceof Error ? err.message : t("common.networkError"));
      }
    }

    run();
    return () => {
      alive = false;
      ac.abort();
    };
  }, []);

  // Machine list (for the "More filters" machine picker)
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/machines", { cache: "no-store" });
        const json = (await res.json().catch(() => ({}))) as { ok?: boolean; machines?: ApiMachineRow[] };
        if (!alive) return;
        if (res.ok && json.ok) setMachines((json.machines ?? []).map((m) => ({ id: m.id, name: m.name })));
      } catch {
        if (alive) setMachines([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Cost rate (Est. cost KPI)
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/downtime/cost-rate", { cache: "no-store" });
        const json = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          costPerMin?: number;
          currency?: string;
          placeholder?: boolean;
        };
        if (!alive) return;
        if (res.ok && json.ok) {
          setCostRate({
            costPerMin: json.costPerMin ?? 0,
            currency: json.currency ?? "USD",
            placeholder: json.placeholder ?? true,
          });
        }
      } catch {
        if (alive) setCostRate(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Events
  useEffect(() => {
    let alive = true;
    const ac = new AbortController();

    async function run() {
      setEventsLoading(true);
      setEventsErr(null);

      try {
        const qs = new URLSearchParams();
        qs.set("range", range);
        qs.set("limit", String(eventsLimit));
        if (machineId) qs.set("machineId", machineId);
        if (reasonCode) qs.set("reasonCode", reasonCode);
        qs.set("shift", shift);
        qs.set("planned", planned);
        qs.set("microstopLtMin", microstopLtMin);
        if (excludeUnclassified) qs.set("excludeUnclassified", "1");
        if (eventsBefore) qs.set("before", eventsBefore);

        const r = await fetch(`/api/analytics/downtime-events?${qs.toString()}`, {
          cache: "no-cache",
          credentials: "include",
          signal: ac.signal,
        });

        const j = (await r.json().catch(() => ({}))) as ApiDowntimeEventsRes;
        if (!alive) return;

        if (!r.ok || j.ok === false) {
          setEventsErr(j?.error ?? t("downtime.err.events"));
          setEventsRes(null);
          setEventsLoading(false);
          return;
        }

        setEventsRes(j);
        setEventsLoading(false);
      } catch (e: any) {
        if (!alive) return;
        setEventsErr(e?.message ?? t("common.networkError"));
        setEventsLoading(false);
      }
    }

    run();
    return () => {
      alive = false;
      ac.abort();
    };
  }, [range, machineId, reasonCode, shift, planned, microstopLtMin, excludeUnclassified, eventsLimit, eventsBefore, reloadNonce]);

  // Derived data
  const events = eventsRes?.events ?? [];
  const paretoEffective = useMemo(() => {
    const normalized = pareto ? normalizeParetoRes(pareto) : null;
    if (normalized?.rows && normalized.rows.length > 0) return normalized;
    const fromEvents = buildParetoFromEvents(events);
    if (!fromEvents) return normalized;
    return {
      ...fromEvents,
      range: (eventsRes?.range as any) ?? normalized?.range,
      start: eventsRes?.start ?? normalized?.start,
      orgId: eventsRes?.orgId ?? normalized?.orgId,
      machineId: eventsRes?.machineId ?? normalized?.machineId ?? null,
      totalMinutesAll: eventsRes?.totalMinutesAll,
      totalMinutesClassified: eventsRes?.totalMinutesClassified,
      excludedUnclassifiedMinutes: eventsRes?.excludedUnclassifiedMinutes,
      excludedUnclassifiedPct: eventsRes?.excludedUnclassifiedPct,
      excludeUnclassified: eventsRes?.excludeUnclassified,
    };
  }, [pareto, events, eventsRes?.orgId, eventsRes?.machineId, eventsRes?.range, eventsRes?.start, eventsRes?.totalMinutesAll, eventsRes?.totalMinutesClassified, eventsRes?.excludedUnclassifiedMinutes, eventsRes?.excludedUnclassifiedPct, eventsRes?.excludeUnclassified]);

  const baseRows = paretoEffective?.rows ?? [];
  const metricRowsAll = useMemo(() => computeMetricRows(baseRows, metric), [baseRows, metric]);

  const metricRowsFiltered = useMemo(() => {
    if (!reasonCode) return metricRowsAll;
    return metricRowsAll.filter((r) => r.reasonCode === reasonCode);
  }, [metricRowsAll, reasonCode]);

  const selectedReasonLabel = useMemo(() => {
    if (!reasonCode) return null;
    const fromMetrics = metricRowsAll.find((row) => row.reasonCode === reasonCode)?.reasonLabel;
    if (fromMetrics) return fromMetrics;
    const fromCatalog = catalogRows.find((row) => row.reasonCode === reasonCode)?.reasonLabel;
    return fromCatalog ?? reasonCode;
  }, [catalogRows, metricRowsAll, reasonCode]);

  const catalogByCategory = useMemo(() => {
    const grouped = new Map<string, { categoryLabel: string; rows: ApiReasonCatalogRow[] }>();
    for (const row of catalogRows) {
      const key = row.categoryId;
      const slot = grouped.get(key) ?? { categoryLabel: row.categoryLabel, rows: [] };
      slot.rows.push(row);
      grouped.set(key, slot);
    }
    return [...grouped.entries()].map(([categoryId, value]) => ({
      categoryId,
      categoryLabel: value.categoryLabel,
      rows: value.rows,
    }));
  }, [catalogRows]);

  const totalMinutes = paretoEffective?.totalMinutesLost ?? 0;
  const totalStops = useMemo(
    () => baseRows.reduce((acc, r) => acc + (r.count ?? 0), 0),
    [baseRows]
  );

  const totalMinutesAll = paretoEffective?.totalMinutesAll ?? totalMinutes;
  const totalMinutesClassified = paretoEffective?.totalMinutesClassified ?? totalMinutes;

  const totalEventsAll = eventsRes?.totalEventsAll ?? totalStops;
  const totalEventsClassified = eventsRes?.totalEventsClassified ?? totalStops;

  // B5 — classification rate against the ≥80% target.
  const CLASSIFICATION_TARGET_PCT = 80;
  const classificationRatePct =
    totalEventsAll > 0 ? Math.round((totalEventsClassified / totalEventsAll) * 1000) / 10 : null;
  const meetsClassificationTarget =
    classificationRatePct != null && classificationRatePct >= CLASSIFICATION_TARGET_PCT;

  const top3Share = useMemo(() => {
    const top3 = metricRowsAll.slice(0, 3);
    return top3.reduce((acc, r) => acc + (r.pctOfTotal ?? 0), 0);
  }, [metricRowsAll]);

  const threshold80Index = useMemo(() => {
    // If API threshold80 exists, it’s based on minutes. For count metric, compute locally.
    if (metric === "minutes") return paretoEffective?.threshold80?.index ?? null;
    const idx = metricRowsAll.findIndex((r) => (r.cumulativePct ?? 0) >= 80);
    return idx >= 0 ? idx : null;
  }, [metric, paretoEffective?.threshold80?.index, metricRowsAll]);

  const heroData = useMemo(() => {
    // Keep hero readable: top 12 (like your screenshot)
    const slice = metricRowsAll.slice(0, 12);
    return slice.map((r, i) => ({
      i,
      code: r.reasonCode,
      label: r.reasonLabel,
      value: r.value,
      cum: r.cumulativePct,
      pct: r.pctOfTotal,
      count: r.count,
    }));
  }, [metricRowsAll]);

  const totalDowntimeMin = totalMinutes;

  useEffect(() => {
    setEventsBefore(null);
  }, [range, machineId, reasonCode, shift, planned, microstopLtMin, excludeUnclassified]);

  const filteredEvents = useMemo(() => {
    let list = events;

    // Heatmap filter (day/hour) — filters by overlap with that hour bucket
    if (heatmapSel) {
      list = list.filter((e) => eventTouchesSlot(e, heatmapSel.day, heatmapSel.hour));
    }

    const q = eventSearch.trim().toLowerCase();
    if (!q) return list;

    return list.filter((e) => {
      const hay = [
        e.machineName ?? "",
        e.reasonLabel ?? "",
        e.reasonCode ?? "",
        e.reasonText ?? "",
        e.workOrderId ?? "",
        e.episodeId ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [events, eventSearch, heatmapSel]);

  const stops = totalStops;

  // Est. cost = downtime minutes × loaded cost/min. Rendered whenever a positive
  // rate exists, placeholder or not (Task B) — the placeholder flag only drives the
  // "illustrative" note, never whether the money shows.
  const estCost =
    costRate && costRate.costPerMin > 0 ? totalDowntimeMin * costRate.costPerMin : null;

  const topReason = metricRowsAll[0] ?? null;

  // Item 7 / Task B — "Money story": per-reason cost = minutes × loaded cost/min.
  // Always uses the MINUTES share (money tracks minutes, not the toggled metric), so
  // the rows sum to the Est. cost KPI by construction (R5/#13 congruence). Computed
  // for placeholder rates too; the card badges them as illustrative.
  const savings = useMemo(() => {
    if (!costRate) return { rows: [], total: 0 };
    const minuteRows = computeMetricRows(baseRows, "minutes");
    return computeSavingsByReason(minuteRows, costRate.costPerMin);
  }, [baseRows, costRate]);
  const savingsByReason = savings.rows;
  const totalSavings = savings.total;

  // Show the money column on tables whenever a positive rate exists (illustrative
  // under placeholder — same ROI-page pattern; the note carries the caveat).
  const showMoneyCol = Boolean(costRate && costRate.costPerMin > 0);

  // Secondary (non-default) filters surfaced as removable chips under the header.
  const hasSecondaryFilters =
    shift !== "ALL" || planned !== "all" || metric !== "minutes" || microstopLtMin !== "2";

  function exportCSV() {
    const rows = metricRowsAll;
    const header = [
      "reasonCode",
      "reasonLabel",
      metric === "minutes" ? "minutesLost" : "count",
      "stops",
      "pctOfTotal",
      "cumulativePct",
    ];
    const lines = [
      `# excludeUnclassified=${excludeUnclassified ? 1 : 0}`,
      `# totalMinutesAll=${totalMinutesAll}`,
      `# totalMinutesClassified=${totalMinutesClassified}`,
      header.join(","),
    ];

    rows.forEach((r) => {
      const v = r.value ?? 0;
      const cells = [
        `"${String(r.reasonCode ?? "").replaceAll('"', '""')}"`,
        `"${String(r.reasonLabel ?? "").replaceAll('"', '""')}"`,
        String(v),
        String(r.count ?? 0),
        String(r.pctOfTotal ?? 0),
        String(r.cumulativePct ?? 0),
      ];
      lines.push(cells.join(","));
    });

    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `downtime_pareto_${metric}_${range}${machineId ? `_machine_${machineId}` : ""}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const machineName = machineId ? machines.find((m) => m.id === machineId)?.name ?? null : null;

  // ── Reusable header bits ────────────────────────────────────────────────
  const scopeChips = (
    <div className="flex flex-wrap items-center gap-2">
      {machineId ? (
        <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white">
          {machineName || t("downtime.scope.machineFiltered")}
          <button
            className="rounded-full border border-white/10 bg-black/20 px-2 py-0.5 text-[11px] text-zinc-200 hover:bg-white/10"
            onClick={() => setParams({ machineId: null, reasonCode: null })}
          >
            ✕
          </button>
        </span>
      ) : null}
      {reasonCode ? (
        <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white">
          {t("downtime.scope.reason")} {selectedReasonLabel ?? reasonCode}
          <button
            className="rounded-full border border-white/10 bg-black/20 px-2 py-0.5 text-[11px] text-zinc-200 hover:bg-white/10"
            onClick={() => setParams({ reasonCode: null })}
          >
            ✕
          </button>
        </span>
      ) : null}
      {heatmapSel ? (
        <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white">
          {t("downtime.scope.heatmap")} {t(`downtime.day.${["sun", "mon", "tue", "wed", "thu", "fri", "sat"][heatmapSel.day]}`)} {String(heatmapSel.hour).padStart(2, "0")}:00
          <button
            className="rounded-full border border-white/10 bg-black/20 px-2 py-0.5 text-[11px] text-zinc-200 hover:bg-white/10"
            onClick={() => setParams({ hmDay: null, hmHour: null })}
          >
            ✕
          </button>
        </span>
      ) : null}
      {shift !== "ALL" ? (
        <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white">
          {t("downtime.filter.shift", { name: shift })}
          <button className="text-zinc-300 hover:text-white" onClick={() => setParams({ shift: null })}>✕</button>
        </span>
      ) : null}
      {planned !== "all" ? (
        <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white">
          {t(`downtime.filter.${planned}`)}
          <button className="text-zinc-300 hover:text-white" onClick={() => setParams({ planned: null })}>✕</button>
        </span>
      ) : null}
      {metric !== "minutes" ? (
        <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white">
          {t("downtime.metric.count")}
          <button className="text-zinc-300 hover:text-white" onClick={() => setParams({ metric: null })}>✕</button>
        </span>
      ) : null}
      {microstopLtMin !== "2" ? (
        <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white">
          {t("downtime.filter.microstopLt")} {microstopLtMin} {t("downtime.filter.min")}
          <button className="text-zinc-300 hover:text-white" onClick={() => setParams({ microstopLtMin: null })}>✕</button>
        </span>
      ) : null}
    </div>
  );

  const hasAnyChip = Boolean(machineId || reasonCode || heatmapSel || hasSecondaryFilters);

  function HeroTooltip({
    active,
    payload,
  }: {
    active?: boolean;
    payload?: Array<{ payload?: any }>;
  }) {
    if (!active || !payload?.length) return null;
    const p = payload[0]?.payload;
    if (!p) return null;

    return (
      <div className="rounded-xl border border-white/10 bg-zinc-950/95 px-4 py-3 shadow-lg">
        <div className="text-sm font-semibold text-white">{p.label}</div>
        <div className="mt-2 space-y-1 text-xs text-zinc-300">
          <div>
            {t("downtime.tooltip.value")}{" "}
            <span className="text-white">
              {metric === "minutes" ? fmtDurationFromMinutes(p.value) : fmtNum(p.value, 0)}
            </span>
          </div>
          <div>
            {t("downtime.tooltip.share")} <span className="text-white">{fmtPct(p.pct, 1)}</span>
          </div>
          <div>
            {t("downtime.tooltip.stops")} <span className="text-white">{fmtNum(p.count, 0)}</span>
          </div>
          <div>
            {t("downtime.tooltip.cumulative")} <span className="text-white">{fmtPct(p.cum, 0)}</span>
          </div>
        </div>
      </div>
    );
  }

  const rangeBtn = (value: Range, label: string) => (
    <button
      onClick={() => setParams({ range: value })}
      className={cn(
        "h-9 rounded-xl border px-3 text-xs",
        range === value
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-100"
          : "border-white/10 bg-white/5 text-zinc-200 hover:bg-white/10"
      )}
    >
      {label}
    </button>
  );

  const viewBtn = (value: DowntimeView, label: string) => (
    <button
      onClick={() => setParams({ view: value })}
      className={cn(
        "h-9 rounded-xl border px-4 text-xs",
        view === value
          ? "border-white/15 bg-white/10 text-white"
          : "border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10"
      )}
    >
      {label}
    </button>
  );

  return (
    <div className="p-4 sm:p-6">
      {/* Header */}
      <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-zinc-950/40 p-6 backdrop-blur-xl">
        <div
          className="pointer-events-none absolute inset-0 opacity-70"
          style={{
            background:
              "radial-gradient(900px 500px at 20% 10%, rgba(16,185,129,.18), transparent 60%)," +
              "radial-gradient(900px 500px at 85% 30%, rgba(59,130,246,.12), transparent 60%)," +
              "radial-gradient(900px 600px at 50% 100%, rgba(244,63,94,.10), transparent 60%)",
          }}
        />

        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="text-2xl font-semibold text-white">{t("downtime.header.title")}</div>
            <div className="mt-1 text-sm text-zinc-300">{t("downtime.header.subtitle")}</div>
          </div>

          <div className="flex flex-wrap items-center gap-2 lg:justify-end">
            <button
              onClick={exportCSV}
              className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white hover:bg-white/10"
            >
              {t("downtime.header.export")}
            </button>
            {machineId ? (
              <Link
                href={`/machines/${encodeURIComponent(machineId)}`}
                className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-100 hover:bg-emerald-500/20"
              >
                {t("downtime.header.backToMachine")}
              </Link>
            ) : null}
          </div>
        </div>

        {/* Primary controls: range + classification toggle + more-filters */}
        <div className="relative mt-5 flex flex-wrap items-center gap-x-4 gap-y-3">
          <div className="flex items-center gap-2">
            {rangeBtn("24h", t("downtime.filter.today"))}
            {rangeBtn("7d", t("downtime.filter.7d"))}
            {rangeBtn("30d", t("downtime.filter.30d"))}
          </div>

          <div className="h-6 w-px bg-white/10" />

          {/* Classification toggle (promoted) */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-300">{t("downtime.classToggle.label")}</span>
            <div className="inline-flex overflow-hidden rounded-xl border border-white/10">
              <button
                onClick={() => setParams({ excludeUnclassified: null })}
                className={cn(
                  "h-9 px-3 text-xs",
                  !excludeUnclassified ? "bg-white/10 text-white" : "bg-white/5 text-zinc-300 hover:bg-white/10"
                )}
              >
                {t("downtime.classToggle.all")}
              </button>
              <button
                onClick={() => setParams({ excludeUnclassified: "1" })}
                className={cn(
                  "h-9 px-3 text-xs",
                  excludeUnclassified ? "bg-emerald-500/15 text-emerald-100" : "bg-white/5 text-zinc-300 hover:bg-white/10"
                )}
              >
                {t("downtime.classToggle.classifiedOnly")}
              </button>
            </div>
            <span className={cn("text-xs", meetsClassificationTarget ? "text-emerald-300" : "text-amber-300")}>
              {classificationRatePct == null
                ? t("downtime.classToggle.rateNoData")
                : t("downtime.classToggle.rate", {
                    pct: fmtNum(classificationRatePct, 0),
                    target: CLASSIFICATION_TARGET_PCT,
                  })}
            </span>
          </div>

          <div className="ml-auto">
            <button
              onClick={() => setShowFilters((v) => !v)}
              className={cn(
                "inline-flex h-9 items-center gap-2 rounded-xl border px-3 text-xs",
                showFilters || hasSecondaryFilters
                  ? "border-white/15 bg-white/10 text-white"
                  : "border-white/10 bg-white/5 text-zinc-200 hover:bg-white/10"
              )}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              {t("downtime.moreFilters")}
            </button>
          </div>
        </div>

        {/* Secondary filters expander */}
        {showFilters ? (
          <div className="relative mt-4 flex flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-black/20 p-3">
            <select
              value={machineId ?? "all"}
              onChange={(e) => setParams({ machineId: e.target.value === "all" ? null : e.target.value, reasonCode: null })}
              className="h-9 rounded-xl border border-white/10 bg-white/5 px-3 text-xs text-zinc-200 outline-none hover:bg-white/10"
            >
              <option value="all">{t("downtime.scope.allMachines")}</option>
              {machines.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name || m.id}
                </option>
              ))}
            </select>

            <select
              value={shift}
              onChange={(e) => setParams({ shift: e.target.value === "all" ? null : e.target.value })}
              className="h-9 rounded-xl border border-white/10 bg-white/5 px-3 text-xs text-zinc-200 outline-none hover:bg-white/10"
            >
              <option value="all">{t("downtime.filter.allShifts")}</option>
              <option value="A">{t("downtime.filter.shift", { name: "A" })}</option>
              <option value="B">{t("downtime.filter.shift", { name: "B" })}</option>
              <option value="C">{t("downtime.filter.shift", { name: "C" })}</option>
            </select>

            <select
              value={planned}
              onChange={(e) => setParams({ planned: e.target.value === "all" ? null : e.target.value })}
              className="h-9 rounded-xl border border-white/10 bg-white/5 px-3 text-xs text-zinc-200 outline-none hover:bg-white/10"
            >
              <option value="all">{t("downtime.filter.plannedUnplanned")}</option>
              <option value="planned">{t("downtime.filter.planned")}</option>
              <option value="unplanned">{t("downtime.filter.unplanned")}</option>
            </select>

            <div className="flex h-9 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 text-xs text-zinc-200">
              <span className="text-zinc-300">{t("downtime.filter.microstopLt")}</span>
              <input
                value={microstopLtMin}
                onChange={(e) => setParams({ microstopLtMin: e.target.value })}
                className="w-10 bg-transparent text-right text-xs text-white outline-none"
              />
              <span className="text-zinc-300">{t("downtime.filter.min")}</span>
            </div>

            <div className="inline-flex overflow-hidden rounded-xl border border-white/10">
              <button
                onClick={() => setParams({ metric: null })}
                className={cn("h-9 px-3 text-xs", metric === "minutes" ? "bg-white/10 text-white" : "bg-white/5 text-zinc-300 hover:bg-white/10")}
              >
                {t("downtime.metric.minutes")}
              </button>
              <button
                onClick={() => setParams({ metric: "count" })}
                className={cn("h-9 px-3 text-xs", metric === "count" ? "bg-white/10 text-white" : "bg-white/5 text-zinc-300 hover:bg-white/10")}
              >
                {t("downtime.metric.count")}
              </button>
            </div>

            <button
              onClick={() =>
                setParams({
                  metric: null,
                  shift: null,
                  planned: null,
                  microstopLtMin: null,
                  machineId: null,
                  reasonCode: null,
                })
              }
              className="h-9 rounded-xl border border-white/10 bg-white/5 px-3 text-xs text-zinc-200 hover:bg-white/10"
            >
              {t("downtime.filter.reset")}
            </button>
          </div>
        ) : null}

        {hasAnyChip ? <div className="relative mt-4">{scopeChips}</div> : null}
      </div>

      {/* Loading / error */}
      {loading ? (
        <div className="mt-6 text-sm text-zinc-300">{t("downtime.loading")}</div>
      ) : err ? (
        <div className="mt-6 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200">
          {err}
        </div>
      ) : null}

      {!loading && !err && (
        <>
          {eventsErr ? (
            <div className="mt-6 rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100">
              {t("downtime.eventsUnavailable", { err: eventsErr })}
            </div>
          ) : null}

          {/* KPI strip — Essentials + cost (5 tiles) */}
          <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
            <KpiTile
              label={t("downtime.kpi.totalDowntime")}
              value={fmtDurationFromMinutes(totalDowntimeMin)}
              caption={t("downtime.kpi.totalDef")}
              tone="primary"
            />
            <KpiTile
              label={t("downtime.kpi.stopsCount")}
              value={fmtNum(stops, 0)}
              caption={t("downtime.kpi.stopsDef")}
            />
            <KpiTile
              label={t("downtime.kpi.topReason")}
              value={topReason ? fmtPct(topReason.pctOfTotal, 1) : null}
              caption={topReason ? topReason.reasonLabel : undefined}
              emptyCaption={t("downtime.breakdown.noData")}
            />
            <KpiTile
              label={t("downtime.kpi.classifiedPct")}
              value={classificationRatePct == null ? null : `${fmtNum(classificationRatePct, 0)}%`}
              caption={t("downtime.kpi.classifiedDef", { target: CLASSIFICATION_TARGET_PCT })}
              emptyCaption={t("downtime.classToggle.rateNoData")}
              tone={meetsClassificationTarget ? "primary" : "neutral"}
            />
            {/* Est. cost — custom tile so the unset state can link to Settings */}
            <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <div className="text-xs text-zinc-400">{t("downtime.kpi.estCost")}</div>
              {estCost != null && costRate ? (
                <>
                  <div
                    className={cn(
                      "mt-2 text-2xl font-semibold",
                      costRate.placeholder ? "text-zinc-200" : "text-white"
                    )}
                  >
                    {fmtMoney(estCost, costRate.currency)}
                  </div>
                  {costRate.placeholder ? (
                    <Link
                      href="/settings"
                      className="mt-1 inline-block text-[11px] text-amber-300 hover:text-amber-200"
                    >
                      {t("downtime.cost.illustrative")} · {t("downtime.cost.setRates")} →
                    </Link>
                  ) : (
                    <div className="mt-1 text-[11px] uppercase tracking-wide text-zinc-400">{t("downtime.kpi.costDef")}</div>
                  )}
                </>
              ) : (
                <>
                  <div className="mt-2 text-2xl font-semibold text-zinc-400">—</div>
                  <Link href="/settings" className="mt-1 inline-block text-[11px] text-emerald-300 hover:text-emerald-200">
                    {t("downtime.cost.setRates")} →
                  </Link>
                </>
              )}
            </div>
          </div>

          {/* View switch */}
          <div className="mt-6 flex flex-wrap items-center gap-2">
            {viewBtn("overview", t("downtime.view.overview"))}
            {viewBtn("events", t("downtime.view.events"))}
          </div>

          {/* ── Overview ── */}
          {view === "overview" && (
            <>
              <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-3">
                {/* Hero chart */}
                <div className="rounded-3xl border border-white/10 bg-white/5 p-5 xl:col-span-2">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="text-lg font-semibold text-white">{t("downtime.hero.title")}</div>
                      <div className="mt-1 text-xs text-zinc-300">
                        {t("downtime.hero.subtitle", { range, metric: metric === "minutes" ? t("downtime.metric.minutes") : t("downtime.metric.count") })}
                      </div>
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-xs text-zinc-300">
                      <div className="text-white">
                        {t("downtime.hero.top3a")}{" "}
                        <span className="font-semibold">{fmtPct(top3Share, 1)}</span>
                      </div>
                      <div className="mt-1 text-zinc-300">{t("downtime.hero.top3b")}</div>
                    </div>
                  </div>

                  <div
                    className="mt-4 h-[360px] rounded-3xl border border-white/10 bg-black/30 p-4 backdrop-blur"
                    style={{ boxShadow: "var(--app-chart-shadow)" }}
                  >
                    <DowntimeParetoHero
                      data={heroData}
                      onBarClick={(code) => setParams({ reasonCode: code })}
                      TooltipContent={HeroTooltip}
                    />
                  </div>

                  {threshold80Index != null && metricRowsAll[threshold80Index] ? (
                    <div className="mt-3 text-xs text-zinc-300">
                      {t("downtime.hero.threshold80")}{" "}
                      <span className="text-white">{metricRowsAll[threshold80Index].reasonLabel}</span>
                    </div>
                  ) : null}
                </div>

                {/* Reason breakdown */}
                <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-lg font-semibold text-white">{t("downtime.breakdown.title")}</div>
                      <div className="mt-1 text-xs text-zinc-300">{t("downtime.breakdown.clickRow")}</div>
                    </div>
                    <div className="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-zinc-300">
                      {t("downtime.breakdown.top", { n: Math.min(12, metricRowsAll.length) })}
                    </div>
                  </div>

                  <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-3">
                    <div className="text-xs font-semibold text-white">{t("downtime.breakdown.menuTitle")}</div>
                    {catalogErr ? (
                      <div className="mt-2 text-[11px] text-rose-300">{catalogErr}</div>
                    ) : null}
                    <div className="mt-3 max-h-[180px] space-y-2 overflow-y-auto no-scrollbar pr-1">
                      {catalogByCategory.map((group) => (
                        <div key={group.categoryId} className="rounded-xl border border-white/10 bg-white/5 p-2">
                          <div className="mb-1 text-[11px] font-semibold text-zinc-300">{group.categoryLabel}</div>
                          <div className="flex flex-wrap gap-1.5">
                            {group.rows.map((option) => {
                              const active = reasonCode === option.reasonCode;
                              return (
                                <button
                                  key={option.reasonCode}
                                  onClick={() => setParams({ reasonCode: option.reasonCode })}
                                  className={cn(
                                    "rounded-lg border px-2 py-1 text-[11px]",
                                    active
                                      ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-200"
                                      : "border-white/10 bg-black/20 text-zinc-300 hover:bg-white/10"
                                  )}
                                >
                                  {option.detailLabel}
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                      {!catalogErr && catalogByCategory.length === 0 ? (
                        <div className="text-[11px] text-zinc-400">{t("downtime.breakdown.noMenu")}</div>
                      ) : null}
                    </div>
                  </div>

                  <div className="mt-4 max-h-[360px] overflow-y-auto no-scrollbar rounded-2xl border border-white/10 bg-black/20">
                    <div className="grid grid-cols-12 gap-2 border-b border-white/10 px-4 py-3 text-[11px] text-zinc-400">
                      <div className="col-span-8">{t("downtime.col.reason")}</div>
                      <div className="col-span-4 text-right">{metric === "minutes" ? t("downtime.metric.minutes") : t("downtime.metric.count")}</div>
                    </div>

                    {metricRowsAll.slice(0, 12).map((r) => {
                      const active = reasonCode === r.reasonCode;
                      return (
                        <button
                          key={r.reasonCode}
                          className={cn(
                            "grid w-full grid-cols-12 gap-2 px-4 py-3 text-left text-sm transition",
                            "border-b border-white/5 hover:bg-white/5",
                            active && "bg-emerald-500/10"
                          )}
                          onClick={() => {
                            setDrawer({ open: true, row: r });
                            setParams({ reasonCode: r.reasonCode });
                          }}
                        >
                          <div className="col-span-8">
                            <div className="truncate text-white">{r.reasonLabel}</div>
                            <div className="mt-1 text-[11px] text-zinc-400">
                              {fmtPct(r.pctOfTotal, 1)} · {t("downtime.breakdown.stopsCount", { n: fmtNum(r.count, 0) })}
                            </div>
                          </div>
                          <div className="col-span-4 text-right">
                            <div className="text-white">
                              {metric === "minutes" ? `${fmtNum(r.value, 1)}m` : fmtNum(r.value, 0)}
                            </div>
                            <div className="mt-1 text-[11px] text-zinc-400">
                              {t("downtime.breakdown.cum", { pct: fmtPct(r.cumulativePct, 0) })}
                            </div>
                          </div>
                        </button>
                      );
                    })}

                    {metricRowsAll.length === 0 ? (
                      <div className="p-4 text-sm text-zinc-300">{t("downtime.breakdown.noData")}</div>
                    ) : null}
                  </div>
                </div>
              </div>

              {/* Savings by reason — the "money story" (Item 7) */}
              <div className="mt-6 rounded-3xl border border-white/10 bg-white/5 p-5">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="text-lg font-semibold text-white">{t("downtime.savings.title")}</div>
                    <div className="mt-1 text-xs text-zinc-300">{t("downtime.savings.subtitle")}</div>
                  </div>
                  {costRate && savingsByReason.length > 0 ? (
                    <div
                      className={cn(
                        "rounded-2xl border px-4 py-3 text-xs",
                        // Neutral tone under placeholder so illustrative money doesn't read as confirmed.
                        costRate.placeholder
                          ? "border-white/10 bg-white/5 text-zinc-200"
                          : "border-emerald-500/20 bg-emerald-500/10 text-emerald-100"
                      )}
                    >
                      {t("downtime.savings.total", { amount: fmtMoney(totalSavings, costRate.currency) })}
                    </div>
                  ) : null}
                </div>

                {!costRate || savingsByReason.length === 0 ? (
                  <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-zinc-300">
                    {!costRate || costRate.placeholder ? (
                      <>
                        {t("downtime.savings.placeholder")}{" "}
                        <Link href="/settings" className="text-emerald-300 hover:text-emerald-200">
                          {t("downtime.cost.setRates")} →
                        </Link>
                      </>
                    ) : (
                      t("downtime.savings.noData")
                    )}
                  </div>
                ) : (
                  <>
                    {costRate?.placeholder ? (
                      <div className="mt-4 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs text-amber-200">
                        {t("downtime.savings.placeholderNote")}{" "}
                        <Link href="/settings" className="font-medium text-amber-100 hover:text-amber-50">
                          {t("downtime.cost.setRates")} →
                        </Link>
                      </div>
                    ) : null}
                    <div className="mt-4 overflow-hidden rounded-2xl border border-white/10 bg-black/20">
                    <div className="grid grid-cols-12 gap-2 border-b border-white/10 px-4 py-3 text-[11px] text-zinc-400">
                      <div className="col-span-6">{t("downtime.col.reason")}</div>
                      <div className="col-span-3 text-right">{t("downtime.savings.col.share")}</div>
                      <div className="col-span-3 text-right">{t("downtime.savings.col.impact")}</div>
                    </div>
                    {savingsByReason.slice(0, 12).map((r) => {
                      const active = reasonCode === r.reasonCode;
                      const costShare = totalSavings > 0 ? (r.cost / totalSavings) * 100 : 0;
                      return (
                        <button
                          key={r.reasonCode}
                          className={cn(
                            "grid w-full grid-cols-12 items-center gap-2 px-4 py-3 text-left text-sm transition",
                            "border-b border-white/5 hover:bg-white/5",
                            active && "bg-emerald-500/10"
                          )}
                          onClick={() => setParams({ reasonCode: r.reasonCode })}
                        >
                          <div className="col-span-6 min-w-0">
                            <div className="truncate text-white">{r.reasonLabel}</div>
                            <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/5">
                              <div
                                className="h-full rounded-full bg-emerald-400/70"
                                style={{ width: `${Math.min(100, costShare)}%` }}
                              />
                            </div>
                            <div className="mt-1 text-[11px] text-zinc-400">
                              {t("downtime.savings.stops", {
                                n: fmtNum(r.count, 0),
                                minutes: fmtDurationFromMinutes(r.minutes),
                              })}
                            </div>
                          </div>
                          <div className="col-span-3 text-right">
                            <div className="text-white">{fmtPct(r.pctOfTotal, 1)}</div>
                            <div className="mt-1 text-[11px] text-zinc-400">
                              {t("downtime.savings.share", { pct: fmtPct(costShare, 0) })}
                            </div>
                          </div>
                          <div className="col-span-3 text-right font-semibold text-emerald-200">
                            {fmtMoney(r.cost, costRate.currency)}
                          </div>
                        </button>
                      );
                    })}
                    </div>
                  </>
                )}
              </div>

              {/* Drilldown table behind an expander */}
              <div className="mt-6 rounded-3xl border border-white/10 bg-white/5 p-5">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="text-lg font-semibold text-white">{t("downtime.drill.title")}</div>
                    <div className="mt-1 text-xs text-zinc-300">
                      {t("downtime.drill.showing", { shown: metricRowsFiltered.length, total: metricRowsAll.length })}
                    </div>
                  </div>
                  <button
                    onClick={() => setShowFullTable((v) => !v)}
                    className="self-start rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-xs text-zinc-200 hover:bg-white/10"
                  >
                    {showFullTable ? t("downtime.hideFullTable") : t("downtime.showFullTable")}
                  </button>
                </div>

                {showFullTable ? (
                  <div className="mt-4 overflow-x-auto rounded-2xl border border-white/10 bg-black/20">
                    <table className="w-full min-w-[860px] text-left text-sm">
                      <thead className="border-b border-white/10 text-[11px] text-zinc-400">
                        <tr>
                          <th className="px-4 py-3">{t("downtime.col.reason")}</th>
                          <th className="px-4 py-3 text-right">{t("downtime.metric.downtime")}</th>
                          <th className="px-4 py-3 text-right">{t("downtime.metric.stops")}</th>
                          <th className="px-4 py-3 text-right">{t("downtime.col.avgDuration")}</th>
                          <th className="px-4 py-3 text-right">{t("downtime.col.share")}</th>
                          <th className="px-4 py-3 text-right">{t("downtime.col.cum")}</th>
                          {showMoneyCol ? (
                            <th className="px-4 py-3 text-right">{t("downtime.col.impact")}</th>
                          ) : null}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-white/5">
                        {metricRowsFiltered.map((r) => {
                          const avg =
                            r.count > 0 && r.minutesLost != null ? r.minutesLost / r.count : null;

                          return (
                            <tr
                              key={r.reasonCode}
                              className={cn(
                                "cursor-pointer hover:bg-white/5",
                                reasonCode === r.reasonCode && "bg-emerald-500/10"
                              )}
                              onClick={() => {
                                setDrawer({ open: true, row: r });
                                setParams({ reasonCode: r.reasonCode });
                              }}
                            >
                              <td className="px-4 py-3">
                                <div className="truncate text-white">{r.reasonLabel}</div>
                                <div className="mt-1 text-[11px] text-zinc-400">{r.reasonCode}</div>
                              </td>
                              <td className="px-4 py-3 text-right text-white">
                                {r.minutesLost != null ? fmtDurationFromMinutes(r.minutesLost) : "—"}
                              </td>
                              <td className="px-4 py-3 text-right text-white">{fmtNum(r.count, 0)}</td>
                              <td className="px-4 py-3 text-right text-zinc-200">
                                {avg == null ? "—" : fmtDurationFromMinutes(avg)}
                              </td>
                              <td className="px-4 py-3 text-right text-zinc-200">{fmtPct(r.pctOfTotal, 1)}</td>
                              <td className="px-4 py-3 text-right text-zinc-200">{fmtPct(r.cumulativePct, 0)}</td>
                              {showMoneyCol && costRate ? (
                                <td className="px-4 py-3 text-right font-medium text-emerald-200">
                                  {fmtMoney((r.minutesLost ?? 0) * costRate.costPerMin, costRate.currency)}
                                </td>
                              ) : null}
                            </tr>
                          );
                        })}

                        {metricRowsFiltered.length === 0 ? (
                          <tr>
                            <td className="px-4 py-6 text-sm text-zinc-300" colSpan={showMoneyCol ? 7 : 6}>
                              {t("downtime.drill.noRows")}
                            </td>
                          </tr>
                        ) : null}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </div>

              {/* Patterns heatmap — kept at the bottom: useful to visualize, out of the way */}
              <div className="mt-6 rounded-3xl border border-white/10 bg-white/5 p-5">
                <div className="text-lg font-semibold text-white">{t("downtime.patterns.title")}</div>
                <div className="mt-1 text-xs text-zinc-300">{t("downtime.patterns.help")}</div>
                <Heatmap
                  events={events}
                  metric={metric}
                  selected={heatmapSel}
                  onSelect={(day, hour) => setParams({ hmDay: String(day), hmHour: String(hour) })}
                  onClear={() => setParams({ hmDay: null, hmHour: null })}
                />
              </div>
            </>
          )}

          {/* ── Events ── */}
          {view === "events" && (
            <div className="mt-6 rounded-3xl border border-white/10 bg-white/5 p-5">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <div className="text-lg font-semibold text-white">{t("downtime.events.title")}</div>
                  <div className="mt-1 text-xs text-zinc-300">{t("downtime.events.help")}</div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <input
                    value={eventSearch}
                    onChange={(e) => setEventSearch(e.target.value)}
                    placeholder={t("downtime.events.searchPlaceholder")}
                    className="h-9 w-[260px] rounded-xl border border-white/10 bg-black/20 px-3 text-xs text-white outline-none placeholder:text-zinc-400"
                  />

                  <select
                    value={String(eventsLimit)}
                    onChange={(e) => {
                      setEventsBefore(null);
                      setEventsLimit(Number(e.target.value));
                    }}
                    className="h-9 rounded-xl border border-white/10 bg-white/5 px-3 text-xs text-zinc-200 outline-none hover:bg-white/10"
                  >
                    <option value="50">50</option>
                    <option value="100">100</option>
                    <option value="200">200</option>
                    <option value="300">300</option>
                    <option value="500">500</option>
                  </select>

                  <button
                    onClick={() => setEventsBefore(null)}
                    className="h-9 rounded-xl border border-white/10 bg-white/5 px-3 text-xs text-zinc-200 hover:bg-white/10"
                  >
                    {t("downtime.events.newest")}
                  </button>

                  <button
                    disabled={!eventsRes?.nextBefore}
                    onClick={() => setEventsBefore(eventsRes?.nextBefore ?? null)}
                    className={cn(
                      "h-9 rounded-xl border px-3 text-xs",
                      eventsRes?.nextBefore
                        ? "border-white/10 bg-white/5 text-zinc-200 hover:bg-white/10"
                        : "border-white/10 bg-white/5 text-zinc-400 opacity-50 cursor-not-allowed"
                    )}
                  >
                    {t("downtime.events.older")}
                  </button>
                </div>
              </div>

              {eventsLoading ? (
                <div className="mt-4 text-sm text-zinc-300">{t("downtime.events.loading")}</div>
              ) : eventsErr ? (
                <div className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200">
                  {eventsErr}
                </div>
              ) : (
                <div className="mt-4 overflow-x-auto rounded-2xl border border-white/10 bg-black/20">
                  <table className="w-full min-w-[980px] text-left text-sm">
                    <thead className="border-b border-white/10 text-[11px] text-zinc-400">
                      <tr>
                        <th className="px-4 py-3">{t("downtime.events.col.start")}</th>
                        <th className="px-4 py-3">{t("downtime.events.col.end")}</th>
                        <th className="px-4 py-3">{t("downtime.events.col.machine")}</th>
                        <th className="px-4 py-3">{t("downtime.col.reason")}</th>
                        <th className="px-4 py-3">{t("downtime.events.col.wo")}</th>
                        <th className="px-4 py-3 text-right">{t("downtime.events.col.duration")}</th>
                        <th className="px-4 py-3 text-right">{t("downtime.events.col.episode")}</th>
                        <th className="px-4 py-3 text-right">{t("downtime.events.col.classify")}</th>
                      </tr>
                    </thead>

                    <tbody className="divide-y divide-white/5">
                      {filteredEvents.map((e) => {
                        const isActive = reasonCode === e.reasonCode;
                        const durMin = e.durationMinutes ?? (e.durationSeconds != null ? e.durationSeconds / 60 : null);

                        return (
                          <tr
                            key={e.id}
                            className={cn(
                              "cursor-pointer hover:bg-white/5",
                              isActive && "bg-emerald-500/10"
                            )}
                            onClick={() => {
                              setParams({ reasonCode: e.reasonCode });
                            }}
                            title={t("downtime.events.focusRow")}
                          >
                            <td className="px-4 py-3 text-zinc-200">{fmtDT(e.startAt, locale)}</td>
                            <td className="px-4 py-3 text-zinc-200">{fmtDT(e.endAt, locale)}</td>
                            <td className="px-4 py-3">
                              <div className="truncate text-white">{e.machineName ?? "—"}</div>
                              <div className="mt-1 text-[11px] text-zinc-400">{e.machineId}</div>
                            </td>
                            <td className="px-4 py-3">
                              <div className="truncate text-white">{e.reasonLabel}</div>
                              <div className="mt-1 text-[11px] text-zinc-400">{e.reasonCode}</div>
                              {e.reasonText && e.reasonText !== e.reasonLabel ? (
                                <div className="mt-1 text-[11px] text-zinc-400">{e.reasonText}</div>
                              ) : null}
                            </td>
                            <td className="px-4 py-3 text-zinc-200">{e.workOrderId ?? "—"}</td>
                            <td className="px-4 py-3 text-right text-white">
                              {durMin == null ? "—" : fmtDurationFromMinutes(durMin)}
                            </td>
                            <td className="px-4 py-3 text-right text-[11px] text-zinc-400">
                              {e.episodeId ?? "—"}
                            </td>
                            <td className="px-4 py-3 text-right">
                              {(() => {
                                const unclassified = /unclass|unknown/i.test(e.reasonCode) || /unclass|unknown/i.test(e.reasonLabel ?? "");
                                return (
                                  <button
                                    type="button"
                                    className={cn(
                                      "rounded-lg px-2.5 py-1 text-[11px] font-medium",
                                      unclassified
                                        ? "bg-amber-500/20 text-amber-200 hover:bg-amber-500/30"
                                        : "text-zinc-400 hover:bg-white/5"
                                    )}
                                    onClick={(ev) => {
                                      ev.stopPropagation();
                                      setReclassifyTarget({
                                        reasonEntryId: e.id,
                                        machineName: e.machineName,
                                        reasonCode: e.reasonCode,
                                        reasonLabel: e.reasonLabel,
                                        startAt: e.startAt,
                                      });
                                    }}
                                  >
                                    {unclassified ? t("downtime.events.classify") : t("downtime.events.reclassify")}
                                  </button>
                                );
                              })()}
                            </td>
                          </tr>
                        );
                      })}

                      {filteredEvents.length === 0 ? (
                        <tr>
                          <td className="px-4 py-6 text-sm text-zinc-300" colSpan={8}>
                            {t("downtime.events.noEvents")}
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              )}

              <div className="mt-3 text-[11px] text-zinc-400">
                {t("downtime.events.tip")}
              </div>
            </div>
          )}
        </>
      )}

      <ReasonDrawer
        open={drawer.open}
        onClose={() => setDrawer({ open: false, row: null })}
        row={drawer.row}
        metric={metric}
      />

      {reclassifyTarget ? (
        <ReclassifyModal
          target={reclassifyTarget}
          onClose={() => setReclassifyTarget(null)}
          onDone={() => {
            setReclassifyTarget(null);
            setReloadNonce((n) => n + 1);
          }}
        />
      ) : null}
    </div>
  );
}
