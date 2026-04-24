"use client";

import { useI18n } from "@/lib/i18n/useI18n";

type Props = {
  moldChangeStartMs: number | null;
  offlineForMin: number | null;
  ongoingStopMin: number | null;
};

function toInt(value: number | null | undefined) {
  if (value == null || Number.isNaN(value)) return 0;
  return Math.max(0, Math.round(value));
}

export default function RecapBanners({ moldChangeStartMs, offlineForMin, ongoingStopMin }: Props) {
  const { t, locale } = useI18n();

  const moldStartLabel = moldChangeStartMs
    ? new Date(moldChangeStartMs).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })
    : "--:--";
  const showOffline = offlineForMin != null && offlineForMin > 10;
  const hideMoldBecauseOffline = showOffline && moldChangeStartMs != null;

  return (
    <div className="space-y-2">
      {moldChangeStartMs && !hideMoldBecauseOffline ? (
        <div className="rounded-xl border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-sm text-amber-200">
          {t("recap.banner.moldChange", { time: moldStartLabel })}
        </div>
      ) : null}

      {showOffline ? (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {t("recap.banner.offline", { min: toInt(offlineForMin) })}
        </div>
      ) : null}

      {ongoingStopMin != null && ongoingStopMin > 0 ? (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {t("recap.banner.ongoingStop", { min: toInt(ongoingStopMin) })}
        </div>
      ) : null}
    </div>
  );
}
