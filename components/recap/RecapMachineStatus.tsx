"use client";

import { useI18n } from "@/lib/i18n/useI18n";
import type { RecapMachine } from "@/lib/recap/types";

type Props = {
  machine: RecapMachine | null;
};

export default function RecapMachineStatus({ machine }: Props) {
  const { t, locale } = useI18n();

  if (!machine) {
    return (
      <div className="rounded-2xl border border-white/10 bg-black/40 p-4">
        <div className="text-sm text-zinc-400">{t("recap.empty.production")}</div>
      </div>
    );
  }

  const isStopped = (machine.downtime.ongoingStopMin ?? 0) > 0;

  return (
    <div className="rounded-2xl border border-white/10 bg-black/40 p-4">
      <div className="mb-3 text-sm font-semibold text-white">{t("recap.machine.title")}</div>
      <ul className="space-y-2 text-sm text-zinc-200">
        <li>
          <span className={isStopped ? "text-red-400" : "text-emerald-400"}>
            {isStopped ? t("recap.machine.stopped") : t("recap.machine.running")}
          </span>
        </li>
        <li>
          <span className={machine.workOrders.moldChangeInProgress ? "text-amber-400" : "text-zinc-300"}>
            {t("recap.machine.mold")}: {machine.workOrders.moldChangeInProgress ? t("common.yes") : t("common.no")}
          </span>
        </li>
        <li className="text-zinc-400">
          {t("recap.machine.lastHeartbeat")}: {machine.heartbeat.lastSeenAt ? new Date(machine.heartbeat.lastSeenAt).toLocaleString(locale) : "--"}
        </li>
        <li className="text-zinc-400">
          {t("recap.machine.uptime")}: {machine.heartbeat.uptimePct == null ? "--" : `${machine.heartbeat.uptimePct.toFixed(1)}%`}
        </li>
      </ul>
    </div>
  );
}
