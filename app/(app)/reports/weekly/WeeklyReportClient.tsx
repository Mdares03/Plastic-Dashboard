"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import WeeklyReport from "@/components/reports/weekly/WeeklyReport";
import type { WeeklyReport as WeeklyReportPayload } from "@/lib/reports/types";
import esMX from "@/lib/i18n/es-MX.json";
import { translateWith, type Dictionary } from "@/lib/i18n/translations";

export default function WeeklyReportClient({ report }: { report: WeeklyReportPayload }) {
  const searchParams = useSearchParams();

  useEffect(() => {
    if (searchParams.get("print") === "1") {
      const timer = window.setTimeout(() => window.print(), 600);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [searchParams]);

  // The weekly report is always rendered in Spanish; bundle just the es-MX
  // dictionary into this route's chunk (not the global client bundle).
  const t = (key: string, vars?: Record<string, string | number>) =>
    translateWith(esMX as Dictionary, key, vars);

  return (
    <div className="relative">
      <div className="flex justify-end px-4 pt-4 sm:px-6 print:hidden">
        <a
          href="/api/reports/pdf?type=weekly"
          className="rounded-xl border border-emerald-400/40 bg-emerald-500/20 px-4 py-2 text-sm text-emerald-100 hover:bg-emerald-500/30"
        >
          {t("reports.downloadPdf")}
        </a>
      </div>
      <WeeklyReport report={report} locale="es-MX" t={t} />
    </div>
  );
}
