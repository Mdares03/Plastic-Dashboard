"use client";

import { useI18n } from "@/lib/i18n/useI18n";

type Props = {
  heartbeat: {
    lastSeenAt: string | null;
    uptimePct: number | null;
    connectionStatus: "online" | "offline";
  };
};

export default function RecapMachineStatus({ heartbeat }: Props) {
  const { t, locale } = useI18n();

  return (
    <div className="rounded-2xl border border-white/10 bg-black/40 p-4">
      <div className="mb-3 text-sm font-semibold text-white">{t("recap.machine.title")}</div>
      <ul className="space-y-2 text-sm text-zinc-200">
        <li>
          <span className={heartbeat.connectionStatus === "online" ? "text-emerald-300" : "text-red-300"}>
            {heartbeat.connectionStatus === "online" ? t("recap.machine.online") : t("recap.machine.offline")}
          </span>
        </li>
        <li className="text-zinc-400">
          {t("recap.machine.lastHeartbeat")}: {heartbeat.lastSeenAt ? new Date(heartbeat.lastSeenAt).toLocaleString(locale) : "--"}
        </li>
        <li className="text-zinc-400">
          {t("recap.machine.uptime")}: {heartbeat.uptimePct == null ? "--" : `${heartbeat.uptimePct.toFixed(1)}%`}
        </li>
      </ul>
    </div>
  );
}
