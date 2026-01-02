"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

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

function fmtPct(v?: number | null) {
  if (v === null || v === undefined || Number.isNaN(v)) return "--";
  return `${v.toFixed(1)}%`;
}

function fmtNum(v?: number | null) {
  if (v === null || v === undefined || Number.isNaN(v)) return "--";
  return `${Math.round(v)}`;
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

function CycleTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const p = payload[0]?.payload;
  if (!p) return null;

  let detail = "";
  if (p.overflow === "low") {
    detail = `Below ${p.rangeEnd?.toFixed(1)}s`;
  } else if (p.overflow === "high") {
    detail = `Above ${p.rangeStart?.toFixed(1)}s`;
  } else if (p.rangeStart != null && p.rangeEnd != null) {
    detail = `${p.rangeStart.toFixed(1)}s - ${p.rangeEnd.toFixed(1)}s`;
  }

  const extreme =
    p.overflow && (p.minValue != null || p.maxValue != null)
      ? `Extremes: ${p.minValue?.toFixed(1) ?? "--"}s - ${p.maxValue?.toFixed(1) ?? "--"}s`
      : "";

  return (
    <div className="rounded-xl border border-white/10 bg-zinc-950/95 px-4 py-3 shadow-lg">
      <div className="text-sm font-semibold text-white">{p.label}</div>
      <div className="mt-2 space-y-1 text-xs text-zinc-300">
        <div>
          Cycles: <span className="text-white">{p.count}</span>
        </div>
        {detail ? (
          <div>
            Range: <span className="text-white">{detail}</span>
          </div>
        ) : null}
        {extreme ? <div className="text-zinc-400">{extreme}</div> : null}
      </div>
    </div>
  );
}

function buildCsv(report: ReportPayload) {
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
  sectionLines.push("section,key,value");
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
  filters: { machine: string; workOrder: string; sku: string }
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
  <title>Report Export</title>
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
  <h1>Reports</h1>
  <div class="meta">Range: ${rangeLabel} | Machine: ${filters.machine} | Work Order: ${filters.workOrder} | SKU: ${filters.sku}</div>

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
    <div class="label">Top Loss Drivers</div>
    <table>
      <thead>
        <tr><th>Metric</th><th>Value</th></tr>
      </thead>
      <tbody>
        <tr><td>Macrostop (sec)</td><td>${downtime.macrostopSec}</td></tr>
        <tr><td>Microstop (sec)</td><td>${downtime.microstopSec}</td></tr>
        <tr><td>Slow Cycles</td><td>${downtime.slowCycleCount}</td></tr>
        <tr><td>Quality Spikes</td><td>${downtime.qualitySpikeCount}</td></tr>
        <tr><td>Performance Degradation</td><td>${downtime.performanceDegradationCount}</td></tr>
        <tr><td>OEE Drops</td><td>${downtime.oeeDropCount}</td></tr>
      </tbody>
    </table>
  </div>

  <div class="card" style="margin-top: 16px;">
    <div class="label">Quality Summary</div>
    <table>
      <thead>
        <tr><th>Metric</th><th>Value</th></tr>
      </thead>
      <tbody>
        <tr><td>Scrap Rate</td><td>${summary.scrapRate != null ? summary.scrapRate.toFixed(1) + "%" : "--"}</td></tr>
        <tr><td>Good Total</td><td>${summary.goodTotal ?? "--"}</td></tr>
        <tr><td>Scrap Total</td><td>${summary.scrapTotal ?? "--"}</td></tr>
        <tr><td>Target Total</td><td>${summary.targetTotal ?? "--"}</td></tr>
        <tr><td>Top Scrap SKU</td><td>${summary.topScrapSku ?? "--"}</td></tr>
        <tr><td>Top Scrap Work Order</td><td>${summary.topScrapWorkOrder ?? "--"}</td></tr>
      </tbody>
    </table>
  </div>

  <div class="card" style="margin-top: 16px;">
    <div class="label">Cycle Time Distribution</div>
    <table>
      <thead>
        <tr><th>Bin</th><th>Count</th></tr>
      </thead>
      <tbody>
        ${cycleBins
          .map((bin) => `<tr><td>${bin.label}</td><td>${bin.count}</td></tr>`)
          .join("")}
      </tbody>
    </table>
  </div>

  <div class="card" style="margin-top: 16px;">
    <div class="label">Notes for Ops</div>
    ${insights.length ? `<ul>${insights.map((n) => `<li>${n}</li>`).join("")}</ul>` : "<div>None</div>"}
  </div>
</body>
</html>
  `.trim();
}

export default function ReportsPage() {
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
    if (range === "24h") return "Last 24 hours";
    if (range === "7d") return "Last 7 days";
    if (range === "30d") return "Last 30 days";
    return "Custom range";
  }, [range]);

  useEffect(() => {
    let alive = true;

    async function loadMachines() {
      try {
        const res = await fetch("/api/machines", { cache: "no-store" });
        const json = await res.json();
        if (!alive) return;
        setMachines((json?.machines ?? []).map((m: any) => ({ id: m.id, name: m.name })));
      } catch {
        if (!alive) return;
        setMachines([]);
      }
    }

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ range });
        if (machineId) params.set("machineId", machineId);
        if (workOrderId) params.set("workOrderId", workOrderId);
        if (sku) params.set("sku", sku);

        const res = await fetch(`/api/reports?${params.toString()}`, { cache: "no-store" });
        const json = await res.json();
        if (!alive) return;
        if (!res.ok || json?.ok === false) {
          setError(json?.error ?? "Failed to load reports");
          setReport(null);
        } else {
          setReport(json);
        }
      } catch {
        if (!alive) return;
        setError("Network error");
        setReport(null);
      } finally {
        if (alive) setLoading(false);
      }
    }

    loadMachines();
    load();
    return () => {
      alive = false;
    };
  }, [range, machineId, workOrderId, sku]);

  useEffect(() => {
    let alive = true;

    async function loadFilters() {
      try {
        const params = new URLSearchParams({ range });
        if (machineId) params.set("machineId", machineId);
        const res = await fetch(`/api/reports/filters?${params.toString()}`, { cache: "no-store" });
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

  const machineLabel = useMemo(() => {
    if (!machineId) return "All machines";
    return machines.find((m) => m.id === machineId)?.name ?? machineId;
  }, [machineId, machines]);

  const workOrderLabel = workOrderId || "All work orders";
  const skuLabel = sku || "All SKUs";

  const handleExportCsv = () => {
    if (!report) return;
    const csv = buildCsv(report);
    downloadText("reports.csv", csv);
  };

  const handleExportPdf = () => {
    if (!report) return;
    const html = buildPdfHtml(report, rangeLabel, {
      machine: machineLabel,
      workOrder: workOrderLabel,
      sku: skuLabel,
    });

    const win = window.open("", "_blank", "width=900,height=650");
    if (!win) return;
    win.document.open();
    win.document.write(html);
    win.document.close();
    win.focus();
    setTimeout(() => win.print(), 300);
  };

  return (
    <div className="p-6">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-white">Reports</h1>
          <p className="text-sm text-zinc-400">
            Trends, downtime, and quality analytics across machines.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleExportCsv}
            className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white hover:bg-white/10"
          >
            Export CSV
          </button>
          <button
            onClick={handleExportPdf}
            className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white hover:bg-white/10"
          >
            Export PDF
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="text-sm font-semibold text-white">Filters</div>
          <div className="text-xs text-zinc-400">{rangeLabel}</div>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl border border-white/10 bg-black/20 p-3">
            <div className="text-[11px] text-zinc-400">Range</div>
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
            <div className="text-[11px] text-zinc-400">Machine</div>
            <select
              value={machineId}
              onChange={(e) => setMachineId(e.target.value)}
              className="mt-2 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-300"
            >
              <option value="">All machines</option>
              {machines.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>

          <div className="rounded-xl border border-white/10 bg-black/20 p-3">
            <div className="text-[11px] text-zinc-400">Work Order</div>
            <input
              list="work-order-list"
              value={workOrderId}
              onChange={(e) => setWorkOrderId(e.target.value)}
              placeholder="All work orders"
              className="mt-2 w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-300 placeholder:text-zinc-500"
            />
            <datalist id="work-order-list">
              {filterOptions.workOrders.map((wo) => (
                <option key={wo} value={wo} />
              ))}
            </datalist>
          </div>

          <div className="rounded-xl border border-white/10 bg-black/20 p-3">
            <div className="text-[11px] text-zinc-400">SKU</div>
            <input
              list="sku-list"
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              placeholder="All SKUs"
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
        {loading && <div className="text-sm text-zinc-400">Loading reports...</div>}
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
              {summary ? "Computed from KPI snapshots." : "No data in selected range."}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <div className="mb-2 text-sm font-semibold text-white">OEE Trend</div>
          <div className="h-[260px] rounded-2xl border border-white/10 bg-black/25 p-4">
            {oeeSeries.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={oeeSeries}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                  <XAxis dataKey="label" tick={{ fill: "#a1a1aa" }} />
                  <YAxis domain={[0, 100]} tick={{ fill: "#a1a1aa" }} />
                  <Tooltip
                    contentStyle={{ background: "rgba(0,0,0,0.85)", border: "1px solid rgba(255,255,255,0.1)" }}
                    labelFormatter={(_, payload) => {
                      const row = payload?.[0]?.payload;
                      return row?.ts ? new Date(row.ts).toLocaleString() : "";
                    }}
                    formatter={(val: any) => [`${Number(val).toFixed(1)}%`, "OEE"]}
                  />
                  <Line type="monotone" dataKey="value" stroke="#34d399" dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-zinc-500">
                No trend data yet.
              </div>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <div className="mb-2 text-sm font-semibold text-white">Downtime Pareto</div>
          <div className="h-[260px] rounded-2xl border border-white/10 bg-black/25 p-4">
            {downtimeSeries.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={downtimeSeries}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                  <XAxis dataKey="name" tick={{ fill: "#a1a1aa" }} />
                  <YAxis tick={{ fill: "#a1a1aa" }} />
                  <Tooltip
                    contentStyle={{ background: "rgba(0,0,0,0.85)", border: "1px solid rgba(255,255,255,0.1)" }}
                    formatter={(val: any) => [`${Number(val)} min`, "Downtime"]}
                  />
                  <Bar dataKey="value" radius={[10, 10, 0, 0]} isAnimationActive={false}>
                    {downtimeSeries.map((row, idx) => (
                      <Cell key={`${row.name}-${idx}`} fill={downtimeColors[row.name] ?? "#94a3b8"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-zinc-500">
                No downtime data yet.
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <div className="mb-2 text-sm font-semibold text-white">Cycle Time Distribution</div>
          <div className="h-[220px] rounded-2xl border border-white/10 bg-black/25 p-4">
            {cycleHistogram.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={cycleHistogram}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                  <XAxis dataKey="label" tick={{ fill: "#a1a1aa", fontSize: 10 }} />
                  <YAxis tick={{ fill: "#a1a1aa" }} />
                  <Tooltip content={<CycleTooltip />} />
                  <Bar dataKey="count" radius={[8, 8, 0, 0]} fill="#60a5fa" isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-zinc-500">
                No cycle data yet.
              </div>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <div className="mb-2 text-sm font-semibold text-white">Scrap Trend</div>
          <div className="h-[220px] rounded-2xl border border-white/10 bg-black/25 p-4">
            {scrapSeries.length ? (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={scrapSeries}>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.08)" />
                  <XAxis dataKey="label" tick={{ fill: "#a1a1aa" }} />
                  <YAxis domain={[0, 100]} tick={{ fill: "#a1a1aa" }} />
                  <Tooltip
                    contentStyle={{ background: "rgba(0,0,0,0.85)", border: "1px solid rgba(255,255,255,0.1)" }}
                    labelFormatter={(_, payload) => {
                      const row = payload?.[0]?.payload;
                      return row?.ts ? new Date(row.ts).toLocaleString() : "";
                    }}
                    formatter={(val: any) => [`${Number(val).toFixed(1)}%`, "Scrap Rate"]}
                  />
                  <Line type="monotone" dataKey="value" stroke="#f97316" dot={false} strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-zinc-500">
                No scrap data yet.
              </div>
            )}
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <div className="mb-2 text-sm font-semibold text-white">Top Loss Drivers</div>
          <div className="space-y-3 text-sm text-zinc-300">
            {[
              { label: "Macrostop", value: fmtDuration(downtime?.macrostopSec) },
              { label: "Microstop", value: fmtDuration(downtime?.microstopSec) },
              { label: "Slow Cycle", value: downtime ? `${downtime.slowCycleCount}` : "--" },
              { label: "Quality Spike", value: downtime ? `${downtime.qualitySpikeCount}` : "--" },
              { label: "OEE Drop", value: downtime ? `${downtime.oeeDropCount}` : "--" },
              {
                label: "Perf Degradation",
                value: downtime ? `${downtime.performanceDegradationCount}` : "--",
              },
            ].map((row) => (
              <div key={row.label} className="flex items-center justify-between rounded-xl border border-white/10 bg-black/20 p-3">
                <span>{row.label}</span>
                <span className="text-xs text-zinc-400">{row.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <div className="mb-3 text-sm font-semibold text-white">Quality Summary</div>
          <div className="space-y-3 text-sm text-zinc-300">
            <div className="rounded-xl border border-white/10 bg-black/20 p-3">
              <div className="text-xs text-zinc-400">Scrap Rate</div>
              <div className="mt-1 text-lg font-semibold text-white">
                {summary?.scrapRate != null ? fmtPct(summary.scrapRate) : "--"}
              </div>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/20 p-3">
              <div className="text-xs text-zinc-400">Top Scrap SKU</div>
              <div className="mt-1 text-sm text-zinc-300">{summary?.topScrapSku ?? "--"}</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/20 p-3">
              <div className="text-xs text-zinc-400">Top Scrap Work Order</div>
              <div className="mt-1 text-sm text-zinc-300">{summary?.topScrapWorkOrder ?? "--"}</div>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <div className="mb-3 text-sm font-semibold text-white">Notes for Ops</div>
          <div className="rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-zinc-300">
            <div className="mb-2 text-xs text-zinc-400">Suggested actions</div>
            {report?.insights && report.insights.length > 0 ? (
              <div className="space-y-2">
                {report.insights.map((note, idx) => (
                  <div key={idx}>{note}</div>
                ))}
              </div>
            ) : (
              <div>No insights yet. Generate reports after data collection.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
