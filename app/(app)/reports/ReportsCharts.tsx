"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type Translator = (key: string, vars?: Record<string, string | number>) => string;
type TooltipPayload<T> = { payload?: T; name?: string; value?: number | string };
type SimpleTooltipProps<T> = {
  active?: boolean;
  payload?: Array<TooltipPayload<T>>;
  label?: string | number;
};

type ChartPoint = { ts: string; label: string; value: number };
type CycleHistogramRow = {
  label: string;
  count: number;
  rangeStart?: number;
  rangeEnd?: number;
  overflow?: "low" | "high";
  minValue?: number;
  maxValue?: number;
};

function CycleTooltip({ active, payload, t }: SimpleTooltipProps<CycleHistogramRow> & { t: Translator }) {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload;
  if (!p) return null;

  let detail = "";
  if (p.overflow === "low") {
    detail = `${t("reports.tooltip.below")} ${p.rangeEnd?.toFixed(1)}s`;
  } else if (p.overflow === "high") {
    detail = `${t("reports.tooltip.above")} ${p.rangeStart?.toFixed(1)}s`;
  } else if (p.rangeStart != null && p.rangeEnd != null) {
    detail = `${p.rangeStart.toFixed(1)}s - ${p.rangeEnd.toFixed(1)}s`;
  }

  const extreme =
    p.overflow && (p.minValue != null || p.maxValue != null)
      ? `${t("reports.tooltip.extremes")}: ${p.minValue?.toFixed(1) ?? "--"}s - ${p.maxValue?.toFixed(1) ?? "--"}s`
      : "";

  return (
    <div className="rounded-xl border border-white/10 bg-zinc-950/95 px-4 py-3 shadow-lg">
      <div className="text-sm font-semibold text-white">{p.label}</div>
      <div className="mt-2 space-y-1 text-xs text-zinc-300">
        <div>
          {t("reports.tooltip.cycles")}: <span className="text-white">{p.count}</span>
        </div>
        {detail ? (
          <div>
            {t("reports.tooltip.range")}: <span className="text-white">{detail}</span>
          </div>
        ) : null}
        {extreme ? <div className="text-zinc-400">{extreme}</div> : null}
      </div>
    </div>
  );
}

function DowntimeTooltip({
  active,
  payload,
  t,
}: SimpleTooltipProps<{ name?: string; value?: number }> & { t: Translator }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload ?? {};
  const label = row.name ?? payload[0]?.name ?? "";
  const value = row.value ?? payload[0]?.value ?? 0;

  return (
    <div className="rounded-xl border border-white/10 bg-zinc-950/95 px-4 py-3 shadow-lg">
      <div className="text-sm font-semibold text-white">{label}</div>
      <div className="mt-2 text-xs text-zinc-300">
        {t("reports.tooltip.downtime")}: <span className="text-white">{Number(value)} min</span>
      </div>
    </div>
  );
}

export default function ReportsCharts({
  oeeSeries,
  downtimeSeries,
  downtimeColors,
  cycleHistogram,
  scrapSeries,
  lossRows,
  locale,
  t,
}: {
  oeeSeries: ChartPoint[];
  downtimeSeries: { name: string; value: number }[];
  downtimeColors: Record<string, string>;
  cycleHistogram: CycleHistogramRow[];
  scrapSeries: ChartPoint[];
  lossRows: Array<{ label: string; value: string }>;
  locale: string;
  t: Translator;
}) {
  return (
    <>
      <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <div className="mb-2 text-sm font-semibold text-white">{t("reports.oeeTrend")}</div>
          <div className="h-[260px] rounded-2xl border border-white/10 bg-black/25 p-4">
            {oeeSeries.length ? (
              <ResponsiveContainer width="100%" height="100%" minHeight={200}>
                <LineChart data={oeeSeries}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--app-chart-grid)" />
                  <XAxis dataKey="label" tick={{ fill: "var(--app-chart-tick)" }} />
                  <YAxis domain={[0, 100]} tick={{ fill: "var(--app-chart-tick)" }} />
                  <Tooltip
                    contentStyle={{
                      background: "var(--app-chart-tooltip-bg)",
                      border: "1px solid var(--app-chart-tooltip-border)",
                    }}
                    labelStyle={{ color: "var(--app-chart-label)" }}
                    labelFormatter={(_, payload) => {
                      const row = payload?.[0]?.payload;
                      return row?.ts ? new Date(row.ts).toLocaleString(locale) : "";
                    }}
                    formatter={(val: number | string | undefined) => [
                      val == null ? "--" : `${Number(val).toFixed(1)}%`,
                      "OEE",
                    ]}
                  />
                  <Line type="monotone" dataKey="value" stroke="#34d399" dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-zinc-500">
                {t("reports.noTrend")}
              </div>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <div className="mb-2 text-sm font-semibold text-white">{t("reports.downtimePareto")}</div>
          <div className="h-[260px] rounded-2xl border border-white/10 bg-black/25 p-4">
            {downtimeSeries.length ? (
              <ResponsiveContainer width="100%" height="100%" minHeight={200}>
                <BarChart data={downtimeSeries}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--app-chart-grid)" />
                  <XAxis dataKey="name" tick={{ fill: "var(--app-chart-tick)" }} />
                  <YAxis tick={{ fill: "var(--app-chart-tick)" }} />
                  <Tooltip content={<DowntimeTooltip t={t} />} />
                  <Bar dataKey="value" radius={[10, 10, 0, 0]} isAnimationActive={false}>
                    {downtimeSeries.map((row, idx) => (
                      <Cell key={`${row.name}-${idx}`} fill={downtimeColors[row.name] ?? "#94a3b8"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-zinc-500">
                {t("reports.noTrend")}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <div className="mb-2 text-sm font-semibold text-white">{t("reports.cycleDistribution")}</div>
          <div className="h-[220px] rounded-2xl border border-white/10 bg-black/25 p-4">
            {cycleHistogram.length ? (
              <ResponsiveContainer width="100%" height="100%" minHeight={200}>
                <BarChart data={cycleHistogram}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--app-chart-grid)" />
                  <XAxis dataKey="label" tick={{ fill: "var(--app-chart-tick)", fontSize: 10 }} />
                  <YAxis tick={{ fill: "var(--app-chart-tick)" }} />
                  <Tooltip content={<CycleTooltip t={t} />} />
                  <Bar dataKey="count" radius={[8, 8, 0, 0]} fill="#60a5fa" isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-zinc-500">
                {t("reports.noCycle")}
              </div>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <div className="mb-2 text-sm font-semibold text-white">{t("reports.scrapTrend")}</div>
          <div className="h-[220px] rounded-2xl border border-white/10 bg-black/25 p-4">
            {scrapSeries.length ? (
              <ResponsiveContainer width="100%" height="100%" minHeight={200}>
                <LineChart data={scrapSeries}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--app-chart-grid)" />
                  <XAxis dataKey="label" tick={{ fill: "var(--app-chart-tick)" }} />
                  <YAxis domain={[0, 100]} tick={{ fill: "var(--app-chart-tick)" }} />
                  <Tooltip
                    contentStyle={{
                      background: "var(--app-chart-tooltip-bg)",
                      border: "1px solid var(--app-chart-tooltip-border)",
                    }}
                    labelStyle={{ color: "var(--app-chart-label)" }}
                    labelFormatter={(_, payload) => {
                      const row = payload?.[0]?.payload;
                      return row?.ts ? new Date(row.ts).toLocaleString(locale) : "";
                    }}
                    formatter={(val: number | string | undefined) => [
                      val == null ? "--" : `${Number(val).toFixed(1)}%`,
                      t("reports.scrapRate"),
                    ]}
                  />
                  <Line type="monotone" dataKey="value" stroke="#f97316" dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-zinc-500">
                {t("reports.noDowntime")}
              </div>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <div className="mb-2 text-sm font-semibold text-white">{t("reports.topLossDrivers")}</div>
          <div className="space-y-3 text-sm text-zinc-300">
            {lossRows.map((row) => (
              <div
                key={row.label}
                className="flex items-center justify-between rounded-xl border border-white/10 bg-black/20 p-3"
              >
                <span>{row.label}</span>
                <span className="text-xs text-zinc-400">{row.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
