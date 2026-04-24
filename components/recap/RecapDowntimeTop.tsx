"use client";

import { Bar, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, BarChart } from "recharts";
import { useI18n } from "@/lib/i18n/useI18n";

type Row = {
  reasonLabel: string;
  minutes: number;
  count: number;
};

type Props = {
  rows: Row[];
};

export default function RecapDowntimeTop({ rows }: Props) {
  const { t } = useI18n();
  const data = rows.slice(0, 3).map((row) => ({ ...row, label: row.reasonLabel.slice(0, 20) }));

  return (
    <div className="rounded-2xl border border-white/10 bg-black/40 p-4">
      <div className="mb-3 text-sm font-semibold text-white">{t("recap.downtime.title")}</div>
      {data.length === 0 ? (
        <div className="text-sm text-zinc-400">{t("recap.empty.production")}</div>
      ) : (
        <>
          <div className="h-[170px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                <XAxis dataKey="label" tick={{ fill: "#a1a1aa", fontSize: 11 }} />
                <YAxis tick={{ fill: "#a1a1aa", fontSize: 11 }} />
                <Tooltip
                  contentStyle={{ background: "rgba(0,0,0,0.85)", border: "1px solid rgba(255,255,255,0.12)" }}
                  labelStyle={{ color: "#e4e4e7" }}
                />
                <Bar dataKey="minutes" fill="#34d399" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 space-y-1">
            {data.map((row) => (
              <div key={row.reasonLabel} className="flex items-center justify-between text-xs text-zinc-300">
                <span className="truncate">{row.reasonLabel}</span>
                <span>
                  {row.minutes.toFixed(1)} min · {row.count}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
