"use client";

import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type FinancialChartPoint = {
  day: string;
  total: number;
  slowCycle: number;
  microstop: number;
  macrostop: number;
  scrap: number;
};

/**
 * The financial cost-by-day area chart, split into its own module so Recharts is
 * code-split (loaded via next/dynamic from FinancialClient) instead of riding the
 * page's initial bundle. Receives only the day series it renders.
 */
export default function FinancialAreaChart({ data }: { data: FinancialChartPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%" minHeight={200}>
      <AreaChart data={data}>
        <defs>
          <linearGradient id="slowFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#facc15" stopOpacity={0.5} />
            <stop offset="95%" stopColor="#facc15" stopOpacity={0.05} />
          </linearGradient>
          <linearGradient id="microFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#fb7185" stopOpacity={0.5} />
            <stop offset="95%" stopColor="#fb7185" stopOpacity={0.05} />
          </linearGradient>
          <linearGradient id="macroFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#f97316" stopOpacity={0.5} />
            <stop offset="95%" stopColor="#f97316" stopOpacity={0.05} />
          </linearGradient>
          <linearGradient id="scrapFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.5} />
            <stop offset="95%" stopColor="#38bdf8" stopOpacity={0.05} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--app-chart-grid)" />
        <XAxis dataKey="day" tick={{ fill: "var(--app-chart-tick)", fontSize: 10 }} />
        <YAxis tick={{ fill: "var(--app-chart-tick)", fontSize: 10 }} />
        <Tooltip
          contentStyle={{
            background: "var(--app-chart-tooltip-bg)",
            border: "1px solid var(--app-chart-tooltip-border)",
          }}
          labelStyle={{ color: "var(--app-chart-label)" }}
        />
        <Area type="monotone" dataKey="slowCycle" stackId="1" stroke="#facc15" fill="url(#slowFill)" />
        <Area type="monotone" dataKey="microstop" stackId="1" stroke="#fb7185" fill="url(#microFill)" />
        <Area type="monotone" dataKey="macrostop" stackId="1" stroke="#f97316" fill="url(#macroFill)" />
        <Area type="monotone" dataKey="scrap" stackId="1" stroke="#38bdf8" fill="url(#scrapFill)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}
