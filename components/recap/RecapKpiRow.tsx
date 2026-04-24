"use client";

import { useI18n } from "@/lib/i18n/useI18n";
import type { RecapRangeMode } from "@/lib/recap/types";

type Props = {
  oeeAvg: number | null;
  goodParts: number;
  totalStops: number;
  scrapParts: number;
  rangeMode?: RecapRangeMode;
};

export default function RecapKpiRow({ oeeAvg, goodParts, totalStops, scrapParts, rangeMode = "24h" }: Props) {
  const { t } = useI18n();
  const oeeLabel =
    rangeMode === "shift"
      ? t("recap.kpi.oeeShift")
      : rangeMode === "yesterday"
        ? t("recap.kpi.oeeYesterday")
        : rangeMode === "custom"
          ? t("recap.kpi.oeeCustom")
          : t("recap.kpi.oee24h");

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
        <div className="mt-1 text-xs uppercase tracking-wide text-zinc-400">{oeeLabel}</div>
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
