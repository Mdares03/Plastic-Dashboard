"use client";

import { useI18n } from "@/lib/i18n/useI18n";
import type { RecapDowntimeTopRow } from "@/lib/recap/types";

type Props = {
  rows: RecapDowntimeTopRow[];
};

export default function RecapDowntimeTop({ rows }: Props) {
  const { t } = useI18n();

  return (
    <div className="rounded-2xl border border-white/10 bg-black/40 p-4">
      <div className="mb-3 text-sm font-semibold text-white">{t("recap.downtime.top")}</div>

      {rows.length === 0 ? (
        <div className="text-sm text-zinc-400">{t("recap.empty.production")}</div>
      ) : (
        <div className="space-y-3">
          {rows.slice(0, 3).map((row) => (
            <div key={row.reasonLabel} className="rounded-xl border border-white/10 bg-black/20 p-3">
              <div className="text-sm font-medium text-white">{row.reasonLabel}</div>
              <div className="mt-1 text-xs text-zinc-300">
                {row.minutes.toFixed(1)} min · {row.percent.toFixed(1)}%
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
