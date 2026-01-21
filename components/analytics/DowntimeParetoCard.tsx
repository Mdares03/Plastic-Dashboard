"use client";

import { useEffect, useMemo, useState } from "react";
import { DOWNTIME_RANGES, type DowntimeRange } from "@/lib/analytics/downtimeRange";
import Link from "next/link";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useI18n } from "@/lib/i18n/useI18n";


type ParetoRow = {
  reasonCode: string;
  reasonLabel: string;
  minutesLost?: number; // downtime
  scrapQty?: number; // scrap (future)
  pctOfTotal: number; // 0..100
  cumulativePct: number; // 0..100
};

type ParetoResponse = {
  ok?: boolean;
  rows?: ParetoRow[];
  top3?: ParetoRow[];
  totalMinutesLost?: number;
  threshold80?: { reasonCode: string; reasonLabel: string; index: number } | null;
  error?: string;
};

type CoverageResponse = {
  ok?: boolean;
  totalDowntimeMinutes?: number;
  receivedMinutes?: number;
  receivedCoveragePct?: number; // could be 0..1 or 0..100 depending on your impl
  pendingEpisodesCount?: number;
};

function clampLabel(s: string, max = 18) {
  if (!s) return "";
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

function normalizePct(v?: number | null) {
  if (v == null || Number.isNaN(v)) return null;
  // If API returns 0..1, convert to 0..100
  return v <= 1 ? v * 100 : v;
}

export default function DowntimeParetoCard({
  machineId,
  range = "7d",
  showCoverage = true,
  showOpenFullReport = true,
  variant = "summary",
  maxBars,
}: {
  machineId?: string;
  range?: DowntimeRange;
  showCoverage?: boolean;
  showOpenFullReport?: boolean;
  variant?: "summary" | "full";
  maxBars?: number; // optional override
}) {
  const { t } = useI18n();
  const isSummary = variant === "summary";
  const barsLimit = maxBars ?? (isSummary ? 5 : 12);
  const chartHeightClass = isSummary ? "h-[240px]" : "h-[360px]";
  const containerPad = isSummary ? "p-4" : "p-5";
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [pareto, setPareto] = useState<ParetoResponse | null>(null);
  const [coverage, setCoverage] = useState<CoverageResponse | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      setLoading(true);
      setErr(null);

      try {
        const qs = new URLSearchParams();
        qs.set("kind", "downtime");
        qs.set("range", range);
        if (machineId) qs.set("machineId", machineId);

        const res = await fetch(`/api/analytics/pareto?${qs.toString()}`, {
          cache: "no-cache",
          credentials: "include",
          signal: controller.signal,
        });

        const json = (await res.json().catch(() => ({}))) as ParetoResponse;

        if (!res.ok || json?.ok === false) {
          setPareto(null);
          setErr(json?.error ?? "Failed to load pareto.");
          setLoading(false);
          return;
        }

        setPareto(json);

        // Optional coverage (fail silently if endpoint not ready)
        if (showCoverage) {
          const cqs = new URLSearchParams();
          cqs.set("kind", "downtime");
          cqs.set("range", range);
          if (machineId) cqs.set("machineId", machineId);

          fetch(`/api/analytics/coverage?${cqs.toString()}`, {
            cache: "no-cache",
            credentials: "include",
            signal: controller.signal,
          })
            .then((r) => (r.ok ? r.json() : null))
            .then((cj) => (cj ? (cj as CoverageResponse) : null))
            .then((cj) => {
              if (cj) setCoverage(cj);
            })
            .catch(() => {
              // ignore
            });
        }

        setLoading(false);
      } catch (e: any) {
        if (e?.name === "AbortError") return;
        setErr("Network error.");
        setLoading(false);
      }
    }

    load();
    return () => controller.abort();
  }, [machineId, range, showCoverage]);

  const rows = pareto?.rows ?? [];

  const chartData = useMemo(() => {
    return rows.slice(0, barsLimit).map((r, idx) => ({
      i: idx,
      reasonCode: r.reasonCode,
      reasonLabel: r.reasonLabel,
      label: clampLabel(r.reasonLabel || r.reasonCode, isSummary ? 16 : 22),
      minutes: Number(r.minutesLost ?? 0),
      pctOfTotal: Number(r.pctOfTotal ?? 0),
      cumulativePct: Number(r.cumulativePct ?? 0),
    }));
  }, [rows, barsLimit, isSummary]);


  const top3 = useMemo(() => {
    if (pareto?.top3?.length) return pareto.top3.slice(0, 3);
    return [...rows]
      .sort((a, b) => Number(b.minutesLost ?? 0) - Number(a.minutesLost ?? 0))
      .slice(0, 3);
  }, [pareto?.top3, rows]);

  const totalMinutes = Number(pareto?.totalMinutesLost ?? 0);

  const covPct = normalizePct(coverage?.receivedCoveragePct ?? null);
  const pending = coverage?.pendingEpisodesCount ?? null;

  const title =
    range === "24h"
      ? "Downtime Pareto (24h)"
      : range === "30d"
        ? "Downtime Pareto (30d)"
        : range === "mtd"
          ? "Downtime Pareto (MTD)"
          : "Downtime Pareto (7d)";


  const reportHref = machineId
    ? `/downtime?machineId=${encodeURIComponent(machineId)}&range=${encodeURIComponent(range)}`
    : `/downtime?range=${encodeURIComponent(range)}`;

  return (
    <div className={`rounded-2xl border border-white/10 bg-white/5 ${containerPad}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-white">{title}</div>
          <div className="mt-1 text-xs text-zinc-400">
            Total: <span className="text-white">{totalMinutes.toFixed(0)} min</span>
            {covPct != null ? (
              <>
                <span className="mx-2 text-zinc-600">•</span>
                Coverage: <span className="text-white">{covPct.toFixed(0)}%</span>
                {pending != null ? (
                  <>
                    <span className="mx-2 text-zinc-600">•</span>
                    Pending: <span className="text-white">{pending}</span>
                  </>
                ) : null}
              </>
            ) : null}
          </div>
        </div>
          {showOpenFullReport ? (
            <Link
              href={reportHref}
              className="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white hover:bg-white/10"
            >
              View full report →
            </Link>
          ) : null}
      </div>

      {loading ? (
        <div className="mt-4 text-sm text-zinc-400">{t("machine.detail.loading")}</div>
      ) : err ? (
        <div className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200">
          {err}
        </div>
      ) : rows.length === 0 ? (
        <div className="mt-4 text-sm text-zinc-400">No downtime reasons found for this range.</div>
      ) : (
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div
            className={`${chartHeightClass} rounded-3xl border border-white/10 bg-black/30 p-4 backdrop-blur lg:col-span-2`}
            style={{ boxShadow: "var(--app-chart-shadow)" }}
          >
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={chartData} margin={{ top: 10, right: 24, left: 0, bottom: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--app-chart-grid)" />
                <XAxis
                  dataKey="label"
                  interval={0}
                  tick={{ fill: "var(--app-chart-tick)", fontSize: 11 }}
                />
                <YAxis
                  yAxisId="left"
                  tick={{ fill: "var(--app-chart-tick)" }}
                  width={40}
                />
                <YAxis
                  yAxisId="right"
                  orientation="right"
                  domain={[0, 100]}
                  tick={{ fill: "var(--app-chart-tick)" }}
                  tickFormatter={(v) => `${v}%`}
                  width={44}
                />
                <Tooltip
                  cursor={{ stroke: "var(--app-chart-grid)" }}
                  contentStyle={{
                    background: "var(--app-chart-tooltip-bg)",
                    border: "1px solid var(--app-chart-tooltip-border)",
                  }}
                  labelStyle={{ color: "var(--app-chart-label)" }}
                  formatter={(val: any, name: any, ctx: any) => {
                    if (name === "minutes") return [`${Number(val).toFixed(1)} min`, "Minutes"];
                    if (name === "cumulativePct") return [`${Number(val).toFixed(1)}%`, "Cumulative"];
                    return [val, name];
                  }}
                />

                <ReferenceLine
                  yAxisId="right"
                  y={80}
                  stroke="rgba(255,255,255,0.25)"
                  strokeDasharray="6 6"
                />

                <Bar
                  yAxisId="left"
                  dataKey="minutes"
                  radius={[10, 10, 0, 0]}
                  isAnimationActive={false}
                  fill="#FF7A00"
                />
                <Line
                  yAxisId="right"
                  dataKey="cumulativePct"
                  dot={false}
                  strokeWidth={2}
                  isAnimationActive={false}
                  stroke="#12D18E"
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <div className={`rounded-2xl border border-white/10 bg-black/20 ${isSummary ? "p-3" : "p-4"}`}>
            <div className="text-xs font-semibold text-white">Top 3 reasons</div>
            <div className="mt-3 space-y-3">
              {top3.map((r) => (
                <div key={r.reasonCode} className="rounded-xl border border-white/10 bg-white/5 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-white">
                        {r.reasonLabel || r.reasonCode}
                      </div>
                      <div className="mt-1 text-xs text-zinc-400">{r.reasonCode}</div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="text-sm font-semibold text-white">
                        {(r.minutesLost ?? 0).toFixed(0)}m
                      </div>
                      <div className="text-xs text-zinc-400">{(r.pctOfTotal ?? 0).toFixed(1)}%</div>
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {!isSummary && pareto?.threshold80 ? (
              <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-3 text-xs text-zinc-300">
                80% cutoff:{" "}
                <span className="text-white">
                  {pareto.threshold80.reasonLabel} ({pareto.threshold80.reasonCode})
                </span>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
