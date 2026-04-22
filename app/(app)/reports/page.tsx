"use client";

import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n/useI18n";

const ReportsCharts = lazy(() => import("./ReportsCharts"));

type RangeKey = "24h" | "7d" | "30d" | "custom";

type ReportSummary = {
  oeeAvg: number | null;
  availabilityAvg: number | null;
  performanceAvg: number | null;
  qualityAvg: number | null;
  goodTotal: number | null;
  scrapTotal: number | null;
  targetTotal: number | null;
  scrapRate: number | null;
  topScrapSku?: string | null;
  topScrapWorkOrder?: string | null;
};

type ReportDowntime = {
  macrostopSec: number;
  microstopSec: number;
  slowCycleCount: number;
  qualitySpikeCount: number;
  performanceDegradationCount: number;
  oeeDropCount: number;
};

type ReportTrendPoint = { t: string; v: number };

type ReportPayload = {
  summary: ReportSummary;
  downtime: ReportDowntime;
  trend: {
    oee: ReportTrendPoint[];
    availability: ReportTrendPoint[];
    performance: ReportTrendPoint[];
    quality: ReportTrendPoint[];
    scrapRate: ReportTrendPoint[];
  };
  distribution: {
    cycleTime: {
      label: string;
      count: number;
      rangeStart?: number;
      rangeEnd?: number;
      overflow?: "low" | "high";
      minValue?: number;
      maxValue?: number;
    }[];
  };
  insights?: string[];
};

type MachineOption = { id: string; name: string };
type FilterOptions = { workOrders: string[]; skus: string[] };
type Translator = (key: string, vars?: Record<string, string | number>) => string;

function fmtPct(v?: number | null) {
  if (v === null || v === undefined || Number.isNaN(v)) return "--";
  return `${v.toFixed(1)}%`;
}

function fmtDuration(sec?: number | null) {
  if (!sec) return "--";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function downsample<T>(rows: T[], max: number) {
  if (rows.length <= max) return rows;
  const step = Math.ceil(rows.length / max);
  return rows.filter((_, idx) => idx % step === 0);
}

function formatTickLabel(ts: string, range: RangeKey) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  if (range === "24h") return `${hh}:${mm}`;
  return `${month}-${day}`;
}

function ReportsChartsSkeleton() {
  return (
    <>
      <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
        {Array.from({ length: 2 }).map((_, idx) => (
          <div key={idx} className="h-[320px] rounded-2xl border border-white/10 bg-white/5" />
        ))}
      </div>
      <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-3">
        {Array.from({ length: 3 }).map((_, idx) => (
          <div key={idx} className="h-[280px] rounded-2xl border border-white/10 bg-white/5" />
        ))}
      </div>
    </>
  );
}

function toMachineOption(value: unknown): MachineOption | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id : "";
  const name = typeof record.name === "string" ? record.name : "";
  if (!id || !name) return null;
  return { id, name };
}

function buildCsv(report: ReportPayload, t: Translator) {
  const rows = new Map<string, Record<string, string | number>>();
  const addSeries = (series: ReportTrendPoint[], key: string) => {
    for (const p of series) {
      const row = rows.get(p.t) ?? { timestamp: p.t };
      row[key] = p.v;
      rows.set(p.t, row);
    }
  };

  addSeries(report.trend.oee, "oee");
  addSeries(report.trend.availability, "availability");
  addSeries(report.trend.performance, "performance");
  addSeries(report.trend.quality, "quality");
  addSeries(report.trend.scrapRate, "scrapRate");

  const ordered = [...rows.values()].sort((a, b) => {
    const at = new Date(String(a.timestamp)).getTime();
    const bt = new Date(String(b.timestamp)).getTime();
    return at - bt;
  });

  const header = ["timestamp", "oee", "availability", "performance", "quality", "scrapRate"].join(",");
  const lines = ordered.map((row) =>
    [
      row.timestamp,
      row.oee ?? "",
      row.availability ?? "",
      row.performance ?? "",
      row.quality ?? "",
      row.scrapRate ?? "",
    ]
      .map((v) => (v == null ? "" : String(v)))
      .join(",")
  );

  const summary = report.summary;
  const downtime = report.downtime;

  const sectionLines: string[] = [];
  sectionLines.push(
    [t("reports.csv.section"), t("reports.csv.key"), t("reports.csv.value")].join(",")
  );
  const addRow = (section: string, key: string, value: string | number | null | undefined) => {
    sectionLines.push(
      [section, key, value == null ? "" : String(value)]
        .map((v) => (v.includes(",") ? `"${v.replace(/\"/g, '""')}"` : v))
        .join(",")
    );
  };

  addRow("summary", "oeeAvg", summary.oeeAvg);
  addRow("summary", "availabilityAvg", summary.availabilityAvg);
  addRow("summary", "performanceAvg", summary.performanceAvg);
  addRow("summary", "qualityAvg", summary.qualityAvg);
  addRow("summary", "goodTotal", summary.goodTotal);
  addRow("summary", "scrapTotal", summary.scrapTotal);
  addRow("summary", "targetTotal", summary.targetTotal);
  addRow("summary", "scrapRate", summary.scrapRate);
  addRow("summary", "topScrapSku", summary.topScrapSku ?? "");
  addRow("summary", "topScrapWorkOrder", summary.topScrapWorkOrder ?? "");

  addRow("loss_drivers", "macrostopSec", downtime.macrostopSec);
  addRow("loss_drivers", "microstopSec", downtime.microstopSec);
  addRow("loss_drivers", "slowCycleCount", downtime.slowCycleCount);
  addRow("loss_drivers", "qualitySpikeCount", downtime.qualitySpikeCount);
  addRow("loss_drivers", "performanceDegradationCount", downtime.performanceDegradationCount);
  addRow("loss_drivers", "oeeDropCount", downtime.oeeDropCount);

  for (const bin of report.distribution.cycleTime) {
    addRow("cycle_distribution", bin.label, bin.count);
  }

  if (report.insights?.length) {
    report.insights.forEach((note, idx) => addRow("insights", String(idx + 1), note));
  }

  return [header, ...lines, "", ...sectionLines].join("\n");
}

function downloadText(filename: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function buildPdfHtml(
  report: ReportPayload,
  rangeLabel: string,
  filters: { machine: string; workOrder: string; sku: string },
  t: Translator
) {
  const summary = report.summary;
  const downtime = report.downtime;
  const cycleBins = report.distribution.cycleTime;
  const insights = report.insights ?? [];

  return `
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${t("reports.pdf.title")}</title>
  <style>
    body { font-family: Arial, sans-serif; color: #111; margin: 24px; }
    h1 { margin: 0 0 6px; }
    .meta { margin-bottom: 16px; color: #555; }
    .grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
    .card { border: 1px solid #ddd; border-radius: 8px; padding: 12px; }
    .label { color: #666; font-size: 12px; text-transform: uppercase; letter-spacing: .03em; }
    .value { font-size: 18px; font-weight: 600; margin-top: 6px; }
    table { width: 100%; border-collapse: collapse; margin-top: 12px; }
    th, td { border: 1px solid #ddd; padding: 6px 8px; font-size: 12px; }
    th { background: #f5f5f5; text-align: left; }
  </style>
</head>
<body>
  <h1>${t("reports.title")}</h1>
  <div class="meta">${t("reports.pdf.range")}: ${rangeLabel} | ${t("reports.pdf.machine")}: ${filters.machine} | ${t("reports.pdf.workOrder")}: ${filters.workOrder} | ${t("reports.pdf.sku")}: ${filters.sku}</div>

  <div class="grid">
    <div class="card">
      <div class="label">OEE (avg)</div>
      <div class="value">${summary.oeeAvg != null ? summary.oeeAvg.toFixed(1) + "%" : "--"}</div>
    </div>
    <div class="card">
      <div class="label">Availability (avg)</div>
      <div class="value">${summary.availabilityAvg != null ? summary.availabilityAvg.toFixed(1) + "%" : "--"}</div>
    </div>
    <div class="card">
      <div class="label">Performance (avg)</div>
      <div class="value">${summary.performanceAvg != null ? summary.performanceAvg.toFixed(1) + "%" : "--"}</div>
    </div>
    <div class="card">
      <div class="label">Quality (avg)</div>
      <div class="value">${summary.qualityAvg != null ? summary.qualityAvg.toFixed(1) + "%" : "--"}</div>
    </div>
  </div>

  <div class="card" style="margin-top: 16px;">
    <div class="label">${t("reports.pdf.topLoss")}</div>
    <table>
      <thead>
        <tr><th>${t("reports.pdf.metric")}</th><th>${t("reports.pdf.value")}</th></tr>
      </thead>
      <tbody>
        <tr><td>${t("reports.loss.macrostop")} (sec)</td><td>${downtime.macrostopSec}</td></tr>
        <tr><td>${t("reports.loss.microstop")} (sec)</td><td>${downtime.microstopSec}</td></tr>
        <tr><td>${t("reports.loss.slowCycle")}</td><td>${downtime.slowCycleCount}</td></tr>
        <tr><td>${t("reports.loss.qualitySpike")}</td><td>${downtime.qualitySpikeCount}</td></tr>
        <tr><td>${t("reports.loss.perfDegradation")}</td><td>${downtime.performanceDegradationCount}</td></tr>
        <tr><td>${t("reports.loss.oeeDrop")}</td><td>${downtime.oeeDropCount}</td></tr>
      </tbody>
    </table>
  </div>

  <div class="card" style="margin-top: 16px;">
    <div class="label">${t("reports.pdf.qualitySummary")}</div>
    <table>
      <thead>
        <tr><th>${t("reports.pdf.metric")}</th><th>${t("reports.pdf.value")}</th></tr>
      </thead>
      <tbody>
        <tr><td>${t("reports.scrapRate")}</td><td>${summary.scrapRate != null ? summary.scrapRate.toFixed(1) + "%" : "--"}</td></tr>
        <tr><td>${t("overview.good")}</td><td>${summary.goodTotal ?? "--"}</td></tr>
        <tr><td>${t("overview.scrap")}</td><td>${summary.scrapTotal ?? "--"}</td></tr>
        <tr><td>${t("overview.target")}</td><td>${summary.targetTotal ?? "--"}</td></tr>
        <tr><td>${t("reports.topScrapSku")}</td><td>${summary.topScrapSku ?? "--"}</td></tr>
        <tr><td>${t("reports.topScrapWorkOrder")}</td><td>${summary.topScrapWorkOrder ?? "--"}</td></tr>
      </tbody>
    </table>
  </div>

  <div class="card" style="margin-top: 16px;">
    <div class="label">${t("reports.pdf.cycleDistribution")}</div>
    <table>
      <thead>
        <tr><th>${t("reports.tooltip.range")}</th><th>${t("reports.tooltip.cycles")}</th></tr>
      </thead>
      <tbody>
        ${cycleBins
          .map((bin) => `<tr><td>${bin.label}</td><td>${bin.count}</td></tr>`)
          .join("")}
      </tbody>
    </table>
  </div>

  <div class="card" style="margin-top: 16px;">
    <div class="label">${t("reports.pdf.notes")}</div>
    ${insights.length ? `<ul>${insights.map((n) => `<li>${n}</li>`).join("")}</ul>` : `<div>${t("reports.pdf.none")}</div>`}
  </div>
</body>
</html>
  `.trim();
}

export default function ReportsPage() {
  const { t, locale } = useI18n();
  const [range, setRange] = useState<RangeKey>("24h");
  const [report, setReport] = useState<ReportPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [machines, setMachines] = useState<MachineOption[]>([]);
  const [filterOptions, setFilterOptions] = useState<FilterOptions>({ workOrders: [], skus: [] });
  const [machineId, setMachineId] = useState("");
  const [workOrderId, setWorkOrderId] = useState("");
  const [sku, setSku] = useState("");

  const rangeLabel = useMemo(() => {
    if (range === "24h") return t("reports.rangeLabel.last24");
    if (range === "7d") return t("reports.rangeLabel.last7");
    if (range === "30d") return t("reports.rangeLabel.last30");
    return t("reports.rangeLabel.custom");
  }, [range, t]);

  useEffect(() => {
    let alive = true;

    async function loadMachines() {
      try {
        const res = await fetch("/api/machines", { cache: "no-store" });
        const json = await res.json();
        if (!alive) return;
        const rows: unknown[] = Array.isArray(json?.machines) ? json.machines : [];
        const options: MachineOption[] = [];
        rows.forEach((row) => {
          const option = toMachineOption(row);
          if (option) options.push(option);
        });
        setMachines(options);
      } catch {
        if (!alive) return;
        setMachines([]);
      }
    }

    loadMachines();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ range });
        if (machineId) params.set("machineId", machineId);
        if (workOrderId) params.set("workOrderId", workOrderId);
        if (sku) params.set("sku", sku);

        const res = await fetch(`/api/reports?${params.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const json = await res.json();
        if (!alive) return;
        if (!res.ok || json?.ok === false) {
          setError(json?.error ?? t("reports.error.failed"));
          setReport(null);
        } else {
          setReport(json);
        }
      } catch {
        if (!alive) return;
        setError(t("reports.error.network"));
        setReport(null);
      } finally {
        if (alive) setLoading(false);
      }
    }

    load();
    return () => {
      alive = false;
      controller.abort();
    };
  }, [range, machineId, workOrderId, sku, t]);

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();

    async function loadFilters() {
      try {
        const params = new URLSearchParams({ range });
        if (machineId) params.set("machineId", machineId);
        const res = await fetch(`/api/reports/filters?${params.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const json = await res.json();
        if (!alive) return;
        if (!res.ok || json?.ok === false) {
          setFilterOptions({ workOrders: [], skus: [] });
        } else {
          setFilterOptions({
            workOrders: json.workOrders ?? [],
            skus: json.skus ?? [],
          });
        }
      } catch {
        if (!alive) return;
        setFilterOptions({ workOrders: [], skus: [] });
      }
    }

    loadFilters();
    return () => {
      alive = false;
      controller.abort();
    };
  }, [range, machineId]);

  const summary = report?.summary;
  const downtime = report?.downtime;
  const trend = report?.trend;
  const distribution = report?.distribution;

  const oeeSeries = useMemo(() => {
    const rows = trend?.oee ?? [];
    const trimmed = downsample(rows, 600);
    return trimmed.map((p) => ({
      ts: p.t,
      label: formatTickLabel(p.t, range),
      value: p.v,
    }));
  }, [trend?.oee, range]);

  const scrapSeries = useMemo(() => {
    const rows = trend?.scrapRate ?? [];
    const trimmed = downsample(rows, 600);
    return trimmed.map((p) => ({
      ts: p.t,
      label: formatTickLabel(p.t, range),
      value: p.v,
    }));
  }, [trend?.scrapRate, range]);

  const cycleHistogram = useMemo(() => {
    return distribution?.cycleTime ?? [];
  }, [distribution?.cycleTime]);

  const downtimeSeries = useMemo(() => {
    if (!downtime) return [];
    return [
      { name: "Macrostop", value: Math.round(downtime.macrostopSec / 60) },
      { name: "Microstop", value: Math.round(downtime.microstopSec / 60) },
    ];
  }, [downtime]);

  const downtimeColors: Record<string, string> = {
    Macrostop: "#FF3B5C",
    Microstop: "#FF7A00",
  };

  const lossRows = useMemo(
    () => [
      { label: t("reports.loss.macrostop"), value: fmtDuration(downtime?.macrostopSec) },
      { label: t("reports.loss.microstop"), value: fmtDuration(downtime?.microstopSec) },
      { label: t("reports.loss.slowCycle"), value: downtime ? `${downtime.slowCycleCount}` : "--" },
      { label: t("reports.loss.qualitySpike"), value: downtime ? `${downtime.qualitySpikeCount}` : "--" },
      { label: t("reports.loss.oeeDrop"), value: downtime ? `${downtime.oeeDropCount}` : "--" },
      {
        label: t("reports.loss.perfDegradation"),
        value: downtime ? `${downtime.performanceDegradationCount}` : "--",
      },
    ],
    [downtime, t]
  );

  const machineLabel = useMemo(() => {
    if (!machineId) return t("reports.filter.allMachines");
    return machines.find((m) => m.id === machineId)?.name ?? machineId;
  }, [machineId, machines, t]);

  const workOrderLabel = workOrderId || t("reports.filter.allWorkOrders");
  const skuLabel = sku || t("reports.filter.allSkus");

  const handleExportCsv = () => {
    if (!report) return;
    const csv = buildCsv(report, t);
    downloadText("reports.csv", csv);
  };

  const handleExportPdf = () => {
    if (!report) return;
    const html = buildPdfHtml(
      report,
      rangeLabel,
      {
        machine: machineLabel,
        workOrder: workOrderLabel,
        sku: skuLabel,
      },
      t
    );

    const win = window.open("", "_blank", "width=900,height=650");
    if (!win) return;
    win.document.open();
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 300);
  };

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">{t("reports.title")}</h1>
          <p className="text-sm text-zinc-400">{t("reports.subtitle")}</p>
        </div>

        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <button
            onClick={handleExportCsv}
            className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white hover:bg-white/10 sm:w-auto"
          >
            {t("reports.exportCsv")}
          </button>
          <button
            onClick={handleExportPdf}
            className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white hover:bg-white/10 sm:w-auto"
          >
            {t("reports.exportPdf")}
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="text-sm font-semibold text-white">{t("reports.filters")}</div>
          <div className="text-xs text-zinc-400">{rangeLabel}</div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl border border-white/10 bg-black/20 p-3">
            <div className="text-[11px] text-zinc-400">{t("reports.filter.range")}</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {(["24h", "7d", "30d", "custom"] as RangeKey[]).map((k) => (
                <button
                  key={k}
                  onClick={() => setRange(k)}
                  className={`rounded-full border px-3 py-1 text-xs ${
                    range === k
                      ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-200"
                      : "border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10"
                  }`}
                >
                  {k.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-white/10 bg-black/20 p-3">
            <div className="text-[11px] text-zinc-400">{t("reports.filter.machine")}</div>
            <select
              value={machineId}
              onChange={(e) => setMachineId(e.target.value)}
              className="mt-2 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-300"
            >
              <option value="">{t("reports.filter.allMachines")}</option>
              {machines.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>

          <div className="rounded-xl border border-white/10 bg-black/20 p-3">
            <div className="text-[11px] text-zinc-400">{t("reports.filter.workOrder")}</div>
            <input
              list="work-order-list"
              value={workOrderId}
              onChange={(e) => setWorkOrderId(e.target.value)}
              placeholder={t("reports.filter.allWorkOrders")}
              className="mt-2 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-300 placeholder:text-zinc-500"
            />
            <datalist id="work-order-list">
              {filterOptions.workOrders.map((wo) => (
                <option key={wo} value={wo} />
              ))}
            </datalist>
          </div>

          <div className="rounded-xl border border-white/10 bg-black/20 p-3">
            <div className="text-[11px] text-zinc-400">{t("reports.filter.sku")}</div>
            <input
              list="sku-list"
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              placeholder={t("reports.filter.allSkus")}
              className="mt-2 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-300 placeholder:text-zinc-500"
            />
            <datalist id="sku-list">
              {filterOptions.skus.map((s) => (
                <option key={s} value={s} />
              ))}
            </datalist>
          </div>
        </div>
      </div>

      <div className="mt-4">
        {loading && <div className="text-sm text-zinc-400">{t("reports.loading")}</div>}
        {error && !loading && (
          <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200">
            {error}
          </div>
        )}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "OEE", value: fmtPct(summary?.oeeAvg), tone: "text-emerald-300" },
          { label: "Availability", value: fmtPct(summary?.availabilityAvg), tone: "text-white" },
          { label: "Performance", value: fmtPct(summary?.performanceAvg), tone: "text-white" },
          { label: "Quality", value: fmtPct(summary?.qualityAvg), tone: "text-white" },
        ].map((kpi) => (
          <div key={kpi.label} className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <div className="text-xs text-zinc-400">{kpi.label} (avg)</div>
            <div className={`mt-2 text-3xl font-semibold ${kpi.tone}`}>{kpi.value}</div>
            <div className="mt-2 text-xs text-zinc-500">
              {summary ? t("reports.kpi.note.withData") : t("reports.kpi.note.noData")}
            </div>
          </div>
        ))}
      </div>

      <Suspense fallback={<ReportsChartsSkeleton />}>
        <ReportsCharts
          oeeSeries={oeeSeries}
          downtimeSeries={downtimeSeries}
          downtimeColors={downtimeColors}
          cycleHistogram={cycleHistogram}
          scrapSeries={scrapSeries}
          lossRows={lossRows}
          locale={locale}
          t={t}
        />
      </Suspense>

      <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <div className="mb-3 text-sm font-semibold text-white">{t("reports.qualitySummary")}</div>
          <div className="space-y-3 text-sm text-zinc-300">
            <div className="rounded-xl border border-white/10 bg-black/20 p-3">
              <div className="text-xs text-zinc-400">{t("reports.scrapRate")}</div>
              <div className="mt-1 text-lg font-semibold text-white">
                {summary?.scrapRate != null ? fmtPct(summary.scrapRate) : "--"}
              </div>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/20 p-3">
              <div className="text-xs text-zinc-400">{t("reports.topScrapSku")}</div>
              <div className="mt-1 text-sm text-zinc-300">{summary?.topScrapSku ?? "--"}</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/20 p-3">
              <div className="text-xs text-zinc-400">{t("reports.topScrapWorkOrder")}</div>
              <div className="mt-1 text-sm text-zinc-300">{summary?.topScrapWorkOrder ?? "--"}</div>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <div className="mb-3 text-sm font-semibold text-white">{t("reports.notes")}</div>
          <div className="rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-zinc-300">
            <div className="mb-2 text-xs text-zinc-400">{t("reports.notes.suggested")}</div>
            {report?.insights && report.insights.length > 0 ? (
              <div className="space-y-2">
                {report.insights.map((note, idx) => (
                  <div key={idx}>{note}</div>
                ))}
              </div>
            ) : (
              <div>{t("reports.notes.none")}</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
