"use client";

import { useI18n } from "@/lib/i18n/useI18n";
import type { RecapSkuRow } from "@/lib/recap/types";

type Props = {
  rows: RecapSkuRow[];
};

export default function RecapProductionBySku({ rows }: Props) {
  const { t } = useI18n();

  return (
    <div className="rounded-2xl border border-white/10 bg-black/40 p-4">
      <div className="mb-3 text-sm font-semibold text-white">{t("recap.production.bySku")}</div>

      {rows.length === 0 ? (
        <div className="text-sm text-zinc-400">{t("recap.empty.production")}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm text-zinc-200">
            <thead>
              <tr className="border-b border-white/10 text-left text-xs uppercase tracking-wide text-zinc-400">
                <th className="py-2 pr-3">{t("recap.production.sku")}</th>
                <th className="py-2 pr-3">{t("recap.production.good")}</th>
                <th className="py-2 pr-3">{t("recap.production.scrap")}</th>
                <th className="py-2 pr-3">{t("recap.production.target")}</th>
                <th className="py-2">{t("recap.production.progress")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 10).map((row) => {
                const progress = row.progressPct == null ? "--" : `${Math.round(row.progressPct)}%`;
                return (
                  <tr key={`${row.sku}:${row.machineName}`} className="border-b border-white/5">
                    <td className="py-2 pr-3">{row.sku}</td>
                    <td className="py-2 pr-3">{row.good}</td>
                    <td className={`py-2 pr-3 ${row.scrap > 0 ? "text-red-300" : ""}`}>{row.scrap}</td>
                    <td className="py-2 pr-3">{row.target ?? "--"}</td>
                    <td className="py-2 text-emerald-300">{progress}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
