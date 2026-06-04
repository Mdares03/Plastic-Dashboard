import type { MachineSnapshot as MachineSnapshotRow, WeeklyReport } from "@/lib/reports/types";

type Translator = (key: string, vars?: Record<string, string | number>) => string;

function fmtPct(value: number) {
  return `${value.toFixed(1)}%`;
}

function renderCard(machine: MachineSnapshotRow, locale: string, t: Translator) {
  return (
    <div key={machine.machineId} className="rounded-xl border border-white/10 bg-black/20 p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold text-white">{machine.name}</div>
        <div className="text-xs text-zinc-400">{machine.machineId}</div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-lg border border-white/10 bg-white/5 p-2">
          <div className="text-[11px] text-zinc-500">OEE</div>
          <div className="font-semibold text-emerald-300">{fmtPct(machine.oee)}</div>
        </div>
        <div className="rounded-lg border border-white/10 bg-white/5 p-2">
          <div className="text-[11px] text-zinc-500">A / P / Q</div>
          <div className="font-semibold text-zinc-200">
            {fmtPct(machine.availability)} / {fmtPct(machine.performance)} / {fmtPct(machine.quality)}
          </div>
        </div>
      </div>

      <div className="mt-3 text-xs text-zinc-400">
        <div>
          {t("reports.weekly.machine.units")}: {machine.unitsProduced.toLocaleString(locale)} / {machine.unitsTarget.toLocaleString(locale)}
        </div>
        <div className="mt-1">
          {t("reports.weekly.machine.topLoss")}: {machine.topLossReasonLabel} ({machine.topLossMinutes.toFixed(0)} min)
        </div>
      </div>
    </div>
  );
}

export default function MachineSnapshot({
  report,
  locale,
  t,
}: {
  report: WeeklyReport;
  locale: string;
  t: Translator;
}) {
  return (
    <div>
      <div className="mb-2 text-sm font-semibold text-white">{t("reports.weekly.machineSnapshot")}</div>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {report.machines.map((machine) => renderCard(machine, locale, t))}
      </div>
    </div>
  );
}
