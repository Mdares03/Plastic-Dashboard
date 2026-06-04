"use client";

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { WeeklyReport } from "@/lib/reports/types";

type Translator = (key: string, vars?: Record<string, string | number>) => string;

type TooltipPayload = {
  payload?: { date: string; oee: number; target: number };
};

function ChartTooltip({ active, payload }: { active?: boolean; payload?: TooltipPayload[] }) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  if (!row) return null;

  return (
    <div className="rounded-xl border border-white/10 bg-zinc-950/95 px-3 py-2 text-xs text-zinc-300">
      <div className="font-semibold text-white">{row.date}</div>
      <div>OEE: <span className="text-emerald-300">{row.oee.toFixed(1)}%</span></div>
      <div>Meta: <span className="text-blue-300">{row.target.toFixed(1)}%</span></div>
    </div>
  );
}

export default function OeeTrendChart({
  report,
  t,
}: {
  report: WeeklyReport;
  t: Translator;
}) {
  return (
    <div>
      <div className="mb-2 text-sm font-semibold text-white">{t("reports.weekly.oeeTrend")}</div>
      <div className="h-60 rounded-xl border border-white/10 bg-black/20 p-3">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={report.oeeTrend7d}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--app-chart-grid)" />
            <XAxis dataKey="date" tick={{ fill: "var(--app-chart-tick)", fontSize: 11 }} />
            <YAxis domain={[0, 100]} tick={{ fill: "var(--app-chart-tick)", fontSize: 11 }} />
            <Tooltip content={<ChartTooltip />} />
            <Line type="monotone" dataKey="target" stroke="#60a5fa" strokeWidth={1.5} dot={false} />
            <Line type="monotone" dataKey="oee" stroke="#34d399" strokeWidth={2.5} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
