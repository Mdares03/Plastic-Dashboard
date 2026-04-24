"use client";

import { useI18n } from "@/lib/i18n/useI18n";

type Props = {
  oeeAvg: number | null;
  goodParts: number;
  totalStops: number;
  scrapParts: number;
};

export default function RecapKpiRow({ oeeAvg, goodParts, totalStops, scrapParts }: Props) {
  const { t } = useI18n();

  const items = [
    { label: t("recap.kpi.good"), value: String(goodParts), valueClass: "text-white" },
    { label: t("recap.kpi.stops"), value: String(totalStops), valueClass: totalStops > 0 ? "text-amber-300" : "text-white" },
    { label: t("recap.kpi.scrap"), value: String(scrapParts), valueClass: scrapParts > 0 ? "text-red-300" : "text-white" },
  ];

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <div className="rounded-2xl border border-white/10 bg-black/40 p-4">
        <div className={`text-2xl font-semibold ${oeeAvg == null || Number.isNaN(oeeAvg) ? "text-zinc-400" : "text-emerald-300"}`}>
          {oeeAvg == null || Number.isNaN(oeeAvg) ? "—" : `${oeeAvg.toFixed(1)}%`}
        </div>
        <div className="mt-1 text-xs uppercase tracking-wide text-zinc-400">{t("recap.kpi.oee")}</div>
        {oeeAvg == null || Number.isNaN(oeeAvg) ? (
          <div className="mt-1 text-xs text-zinc-500">{t("recap.kpi.noData")}</div>
        ) : null}
      </div>
      {items.map((item) => (
        <div key={item.label} className="rounded-2xl border border-white/10 bg-black/40 p-4">
          <div className={`text-2xl font-semibold ${item.valueClass}`}>{item.value}</div>
          <div className="mt-1 text-xs uppercase tracking-wide text-zinc-400">{item.label}</div>
        </div>
      ))}
    </div>
  );
}
