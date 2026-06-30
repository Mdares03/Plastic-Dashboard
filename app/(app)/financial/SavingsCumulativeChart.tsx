"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type SavingsMonthPoint = {
  month: string; // YYYY-MM
  label: string; // localized short month label
  total: number;
  cumulative: number;
};

/**
 * Cumulative view of the savings calendar (Item 2): monthly cost-of-losses bars
 * plus a running cumulative line on a secondary axis. Split into its own module so
 * Recharts is code-split (loaded via next/dynamic) like FinancialAreaChart.
 */
export default function SavingsCumulativeChart({
  data,
  formatMoney,
  formatAxis,
}: {
  data: SavingsMonthPoint[];
  formatMoney: (value: number) => string;
  formatAxis: (value: number) => string;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%" minHeight={220}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
        <defs>
          <linearGradient id="savingsBar" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#34d399" stopOpacity={0.85} />
            <stop offset="95%" stopColor="#34d399" stopOpacity={0.25} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--app-chart-grid)" />
        <XAxis dataKey="label" tick={{ fill: "var(--app-chart-tick)", fontSize: 10 }} />
        <YAxis
          yAxisId="month"
          tick={{ fill: "var(--app-chart-tick)", fontSize: 10 }}
          tickFormatter={(v) => formatAxis(Number(v))}
          width={70}
        />
        <YAxis
          yAxisId="cum"
          orientation="right"
          tick={{ fill: "var(--app-chart-tick)", fontSize: 10 }}
          tickFormatter={(v) => formatAxis(Number(v))}
          width={70}
        />
        <Tooltip
          contentStyle={{
            background: "var(--app-chart-tooltip-bg)",
            border: "1px solid var(--app-chart-tooltip-border)",
          }}
          labelStyle={{ color: "var(--app-chart-label)" }}
          formatter={(value: unknown) => formatMoney(Number(value))}
        />
        <Bar
          yAxisId="month"
          dataKey="total"
          fill="url(#savingsBar)"
          radius={[4, 4, 0, 0]}
          isAnimationActive={false}
        />
        <Line
          yAxisId="cum"
          type="monotone"
          dataKey="cumulative"
          stroke="#fbbf24"
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
