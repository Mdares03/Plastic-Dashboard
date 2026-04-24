"use client";

import { useI18n } from "@/lib/i18n/useI18n";
import type { RecapWorkOrders as RecapWorkOrdersType } from "@/lib/recap/types";

type Props = {
  workOrders: RecapWorkOrdersType;
};

export default function RecapWorkOrders({ workOrders }: Props) {
  const { t, locale } = useI18n();

  return (
    <div className="rounded-2xl border border-white/10 bg-black/40 p-4">
      <div className="mb-3 text-sm font-semibold text-white">{t("recap.workOrders.title")}</div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <div className="text-xs uppercase tracking-wide text-zinc-400">{t("recap.workOrders.completed")}</div>
          {workOrders.completed.length === 0 ? (
            <div className="mt-2 text-sm text-zinc-400">{t("recap.workOrders.none")}</div>
          ) : (
            <div className="mt-2 space-y-2">
              {workOrders.completed.slice(0, 6).map((row) => (
                <div key={row.id} className="rounded-lg border border-white/10 bg-black/20 p-2 text-xs text-zinc-300">
                  <div className="font-medium text-white">{row.id}</div>
                  <div>{t("recap.workOrders.sku")}: {row.sku || "--"}</div>
                  <div>{t("recap.workOrders.goodParts")}: {row.goodParts}</div>
                  <div>{t("recap.workOrders.duration")}: {row.durationHrs.toFixed(2)}h</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div>
          <div className="text-xs uppercase tracking-wide text-zinc-400">{t("recap.workOrders.active")}</div>
          {!workOrders.active ? (
            <div className="mt-2 text-sm text-zinc-400">{t("recap.workOrders.none")}</div>
          ) : (
            <div className="mt-2 rounded-lg border border-white/10 bg-black/20 p-3 text-sm text-zinc-200">
              <div className="font-medium text-white">{workOrders.active.id}</div>
              <div className="text-zinc-400">{t("recap.workOrders.sku")}: {workOrders.active.sku || "--"}</div>
              <div className="mt-2 h-2 rounded-full bg-white/10">
                <div
                  className="h-2 rounded-full bg-emerald-400"
                  style={{ width: `${Math.max(0, Math.min(100, workOrders.active.progressPct ?? 0))}%` }}
                />
              </div>
              <div className="mt-2 text-xs text-zinc-400">
                {t("recap.workOrders.startedAt")}: {workOrders.active.startedAt ? new Date(workOrders.active.startedAt).toLocaleString(locale) : "--"}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
