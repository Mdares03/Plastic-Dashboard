"use client";

import WeeklyReport from "@/components/reports/weekly/WeeklyReport";
import type { WeeklyReport as WeeklyReportPayload } from "@/lib/reports/types";
import esMX from "@/lib/i18n/es-MX.json";
import { translateWith, type Dictionary } from "@/lib/i18n/translations";

/**
 * Print-only render of the weekly/daily report (item 3). No app shell, no session —
 * reached by Puppeteer via a signed print token. Always Spanish, matching the
 * in-app weekly report. A dark wrapper preserves the dashboard look in the PDF.
 */
export default function PrintReport({ report }: { report: WeeklyReportPayload }) {
  const t = (key: string, vars?: Record<string, string | number>) =>
    translateWith(esMX as Dictionary, key, vars);

  return (
    <div className="min-h-screen bg-zinc-950">
      <WeeklyReport report={report} locale="es-MX" t={t} />
    </div>
  );
}
