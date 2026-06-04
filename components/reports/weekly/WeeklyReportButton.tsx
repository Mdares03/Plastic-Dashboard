"use client";

import { Download, ExternalLink } from "lucide-react";
import { useI18n } from "@/lib/i18n/useI18n";

export default function WeeklyReportButton({
  previewHref = "/reports/weekly",
  printHref = "/reports/weekly?print=1",
}: {
  previewHref?: string;
  printHref?: string;
}) {
  const { t } = useI18n();

  const openPrintable = () => {
    window.open(printHref, "_blank", "noopener,noreferrer");
  };

  const openPreview = () => {
    window.open(previewHref, "_blank", "noopener,noreferrer");
  };

  return (
    <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
      <button
        type="button"
        onClick={openPrintable}
        className="w-full rounded-xl border border-emerald-500/30 bg-emerald-500/15 px-4 py-2 text-sm text-emerald-200 hover:bg-emerald-500/30 sm:w-auto"
      >
        <span className="inline-flex items-center gap-2">
          <Download className="h-4 w-4" />
          {t("reports.weekly.download")}
        </span>
      </button>

      <button
        type="button"
        onClick={openPreview}
        className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-zinc-200 hover:bg-white/10 sm:w-auto"
      >
        <span className="inline-flex items-center gap-2">
          <ExternalLink className="h-4 w-4" />
          {t("reports.weekly.preview")}
        </span>
      </button>
    </div>
  );
}
