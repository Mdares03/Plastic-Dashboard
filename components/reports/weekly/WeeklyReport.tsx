import type { WeeklyReport as WeeklyReportPayload } from "@/lib/reports/types";
import CyclePerformanceTable from "@/components/reports/weekly/sections/CyclePerformanceTable";
import DataQualityNote from "@/components/reports/weekly/sections/DataQualityNote";
import DowntimeClassified from "@/components/reports/weekly/sections/DowntimeClassified";
import HeaderBand from "@/components/reports/weekly/sections/HeaderBand";
import KpiStrip from "@/components/reports/weekly/sections/KpiStrip";
import MachineSnapshot from "@/components/reports/weekly/sections/MachineSnapshot";
import OeeTrendChart from "@/components/reports/weekly/sections/OeeTrendChart";
import RecommendedActions from "@/components/reports/weekly/sections/RecommendedActions";
import ScrapTopOffenders from "@/components/reports/weekly/sections/ScrapTopOffenders";
import TopLossesCard from "@/components/reports/weekly/sections/TopLossesCard";
import WorkOrderStatusTable from "@/components/reports/weekly/sections/WorkOrderStatusTable";

type Translator = (key: string, vars?: Record<string, string | number>) => string;

export default function WeeklyReport({
  report,
  locale,
  t,
}: {
  report: WeeklyReportPayload;
  locale: string;
  t: Translator;
}) {
  return (
    <div className="weekly-report mx-auto max-w-[980px] p-4 sm:p-6">
      <section className="page space-y-4" data-weekly-page="1">
        <HeaderBand report={report} locale={locale} t={t} />
        <KpiStrip report={report} locale={locale} t={t} />

        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <MachineSnapshot report={report} locale={locale} t={t} />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="rounded-xl border border-white/10 bg-white/5 p-4 lg:col-span-2">
            <OeeTrendChart report={report} t={t} />
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 p-4">
            <TopLossesCard report={report} locale={locale} t={t} />
          </div>
        </div>
      </section>

      <section className="page page-break mt-4 space-y-4" data-weekly-page="2">
        <CyclePerformanceTable report={report} locale={locale} t={t} />
        <DowntimeClassified report={report} t={t} />
        <ScrapTopOffenders report={report} locale={locale} t={t} />
        <WorkOrderStatusTable report={report} locale={locale} t={t} />
        <RecommendedActions report={report} locale={locale} t={t} />
        <DataQualityNote report={report} t={t} />
      </section>
    </div>
  );
}
