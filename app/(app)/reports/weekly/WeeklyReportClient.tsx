"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";
import WeeklyReport from "@/components/reports/weekly/WeeklyReport";
import type { WeeklyReport as WeeklyReportPayload } from "@/lib/reports/types";
import { translate } from "@/lib/i18n/translations";

export default function WeeklyReportClient({ report }: { report: WeeklyReportPayload }) {
  const searchParams = useSearchParams();

  useEffect(() => {
    if (searchParams.get("print") === "1") {
      const timer = window.setTimeout(() => window.print(), 600);
      return () => window.clearTimeout(timer);
    }
    return undefined;
  }, [searchParams]);

  const t = (key: string, vars?: Record<string, string | number>) =>
    translate("es-MX", key, vars);

  return <WeeklyReport report={report} locale="es-MX" t={t} />;
}
