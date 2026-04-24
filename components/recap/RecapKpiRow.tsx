"use client";

import { useI18n } from "@/lib/i18n/useI18n";

type Props = {
  oeeAvg: number | null;
  goodParts: number;
  totalStops: number;
  scrapParts: number;
};

function fmtPct(v: number | null) {
  if (v == null || Number.isNaN(v)) return "--";
  return `${v.toFixed(1)}%`;
}

export default function RecapKpiRow({ oeeAvg, goodParts, totalStops, scrapParts }: Props) {
  const { t } = useI18n();

  const items = [
    { label: t("recap.kpi.oee"), value: fmtPct(oeeAvg), valueClass: "text-emerald-400" },
    { label: t("recap.kpi.good"), value: String(goodParts), valueClass: "text-white" },
    { label: t("recap.kpi.stops"), value: String(totalStops), valueClass: totalStops > 0 ? "text-amber-400" : "text-white" },
    { label: t("recap.kpi.scrap"), value: String(scrapParts), valueClass: scrapParts > 0 ? "text-red-400" : "text-white" },
  ];

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
      {items.map((item) => (
        <div key={item.label} className="rounded-2xl border border-white/10 bg-black/40 p-4">
          <div className={`text-2xl font-semibold ${item.valueClass}`}>{item.value}</div>
          <div className="mt-1 text-xs uppercase tracking-wide text-zinc-400">{item.label}</div>
        </div>
      ))}
    </div>
  );
}
