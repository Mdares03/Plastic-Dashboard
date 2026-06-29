"use client";

import type { ComponentType } from "react";
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

export type HeroPoint = {
  i: number;
  code: string;
  label: string;
  value: number;
  cum: number;
  pct: number;
  count: number;
};

/**
 * The downtime Pareto hero chart (bars + cumulative line), split into its own
 * module so Recharts is code-split (loaded via next/dynamic from
 * DowntimePageClient) rather than shipped in the page's initial bundle. The
 * tooltip stays in the parent (it closes over the page's formatters / metric) and
 * is passed in as a component.
 */
export default function DowntimeParetoHero({
  data,
  onBarClick,
  TooltipContent,
}: {
  data: HeroPoint[];
  onBarClick: (code: string) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  TooltipContent: ComponentType<any>;
}) {
  return (
    <ResponsiveContainer width="100%" height="100%" minHeight={200}>
      <ComposedChart
        data={data}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onClick={(st: any) => {
          const p = st?.activePayload?.[0]?.payload;
          if (!p?.code) return;
          onBarClick(p.code);
        }}
      >
        <CartesianGrid strokeDasharray="3 3" stroke="var(--app-chart-grid)" />
        <XAxis
          dataKey="label"
          interval={0}
          tick={{ fill: "var(--app-chart-tick)" }}
          tickFormatter={(v: string) => (v.length > 14 ? `${v.slice(0, 14)}…` : v)}
        />
        <YAxis yAxisId="left" tick={{ fill: "var(--app-chart-tick)" }} />
        <YAxis
          yAxisId="right"
          orientation="right"
          domain={[0, 100]}
          tick={{ fill: "var(--app-chart-tick)" }}
          tickFormatter={(v: number) => `${v}%`}
        />
        <Tooltip content={<TooltipContent />} cursor={{ stroke: "var(--app-chart-grid)" }} />

        <Bar
          yAxisId="left"
          dataKey="value"
          radius={[10, 10, 0, 0]}
          isAnimationActive={false}
          fill="rgba(16,185,129,0.85)"
        />
        <Line
          yAxisId="right"
          type="monotone"
          dataKey="cum"
          stroke="rgba(110,231,183,0.95)"
          strokeWidth={2}
          dot={false}
          isAnimationActive={false}
        />
        <ReferenceLine yAxisId="right" y={80} stroke="rgba(255,255,255,0.25)" strokeDasharray="6 6" />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
