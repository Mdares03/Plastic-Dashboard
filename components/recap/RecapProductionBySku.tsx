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
      <div className="mb-3 text-sm font-semibold text-white">{t("recap.production.title")}</div>
      {rows.length === 0 ? (
        <div className="text-sm text-zinc-400">{t("recap.empty.production")}</div>
      ) : (
        <div className="space-y-2">
          <div className="grid grid-cols-6 gap-2 border-b border-white/10 pb-2 text-xs uppercase tracking-wide text-zinc-400">
            <div>Maquina</div>
            <div>SKU</div>
            <div>{t("recap.production.good")}</div>
            <div>{t("recap.production.scrap")}</div>
            <div>{t("recap.production.target")}</div>
            <div>{t("recap.production.progress")}</div>
          </div>
          {rows.slice(0, 8).map((row) => {
            const pct = row.progressPct == null ? "--" : `${Math.round(row.progressPct)}%`;
            return (
              <div key={`${row.machineName}:${row.sku}`} className="grid grid-cols-6 gap-2 text-sm text-zinc-200">
                <div className="truncate text-zinc-400">{row.machineName}</div>
                <div className="truncate">{row.sku}</div>
                <div>{row.good}</div>
                <div className={row.scrap > 0 ? "text-red-400" : "text-zinc-200"}>{row.scrap}</div>
                <div>{row.target ?? "--"}</div>
                <div>
                  <span className="text-emerald-400">{pct}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
