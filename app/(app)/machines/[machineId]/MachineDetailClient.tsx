"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useI18n } from "@/lib/i18n/useI18n";

type Heartbeat = {
  ts: string;
  status: string;
  message?: string | null;
  ip?: string | null;
  fwVersion?: string | null;
};

type Kpi = {
  ts: string;
  oee?: number | null;
  availability?: number | null;
  performance?: number | null;
  quality?: number | null;
  workOrderId?: string | null;
  sku?: string | null;
  good?: number | null;
  scrap?: number | null;
  target?: number | null;
  cycleTime?: number | null;
};

type EventRow = {
  id: string;
  ts: string;
  topic: string;
  eventType: string;
  severity: string;
  title: string;
  description?: string | null;
  requiresAck: boolean;
};

type CycleRow = {
  ts: string;
  t: number;
  cycleCount: number | null;
  actual: number;
  ideal: number | null;
  workOrderId: string | null;
  sku: string | null;
};

type CycleDerivedRow = CycleRow & {
  extra: number | null;
  bucket: "normal" | "slow" | "microstop" | "macrostop" | "unknown";
};

type MachineDetail = {
  id: string;
  name: string;
  code?: string | null;
  location?: string | null;
  latestHeartbeat: Heartbeat | null;
  latestKpi: Kpi | null;
};

type Thresholds = {
  stoppageMultiplier: number;
  macroStoppageMultiplier: number;
};

type TimelineState = "normal" | "slow" | "microstop" | "macrostop";

type TimelineSeg = {
  start: number;
  end: number;
  durationSec: number;
  state: TimelineState;
};

type UploadState = {
  status: "idle" | "parsing" | "uploading" | "success" | "error";
  message?: string;
  count?: number;
};

type WorkOrderUpload = {
  workOrderId: string;
  sku?: string;
  targetQty?: number;
  cycleTime?: number;
};

const TOL = 0.10;
const DEFAULT_MICRO_MULT = 1.5;
const DEFAULT_MACRO_MULT = 5;
const NORMAL_TOL_SEC = 0.1;


function resolveMultipliers(thresholds?: Thresholds | null) {
  const micro = Number(thresholds?.stoppageMultiplier ?? DEFAULT_MICRO_MULT);
  const macro = Math.max(
    micro,
    Number(thresholds?.macroStoppageMultiplier ?? DEFAULT_MACRO_MULT)
  );
  return { micro, macro };
}

function classifyCycleDuration(
  actualSec: number,
  idealSec: number,
  thresholds?: Thresholds | null
): TimelineState {
  const { micro, macro } = resolveMultipliers(thresholds);

  if (actualSec < idealSec + NORMAL_TOL_SEC) return "normal";
  if (actualSec < idealSec * micro) return "slow";
  if (actualSec < idealSec * macro) return "microstop";
  return "macrostop";
}


const WORK_ORDER_KEYS = {
  id: new Set(["workorderid", "workorder", "orderid", "woid", "work_order_id", "otid"]),
  sku: new Set(["sku"]),
  cycle: new Set([
    "theoreticalcycletimeseconds",
    "theoreticalcycletime",
    "cycletime",
    "cycle_time",
    "theoretical_cycle_time",
  ]),
  target: new Set(["targetquantity", "targetqty", "target", "target_qty"]),
};

function normalizeKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function parseCsvText(text: string) {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];

    if (ch === "\"") {
      if (inQuotes && text[i + 1] === "\"") {
        field += "\"";
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (ch === "," && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }

    if ((ch === "\n" || ch === "\r") && !inQuotes) {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      field = "";
      if (row.some((cell) => cell.trim().length > 0)) {
        rows.push(row);
      }
      row = [];
      continue;
    }

    field += ch;
  }

  row.push(field);
  if (row.some((cell) => cell.trim().length > 0)) {
    rows.push(row);
  }

  if (!rows.length) return [];

  const headers = rows.shift()!.map((h) => h.trim());
  return rows.map((cols) => {
    const obj: Record<string, string> = {};
    headers.forEach((header, idx) => {
      obj[header] = (cols[idx] ?? "").trim();
    });
    return obj;
  });
}

function pickRowValue(row: Record<string, any>, keys: Set<string>) {
  for (const [key, value] of Object.entries(row)) {
    if (keys.has(normalizeKey(key))) return value;
  }
  return undefined;
}

function rowsToWorkOrders(rows: Array<Record<string, any>>): WorkOrderUpload[] {
  const seen = new Set<string>();
  const out: WorkOrderUpload[] = [];

  rows.forEach((row) => {
    const rawId = pickRowValue(row, WORK_ORDER_KEYS.id);
    const workOrderId = String(rawId ?? "").trim();
    if (!workOrderId || seen.has(workOrderId)) return;
    seen.add(workOrderId);

    const sku = String(pickRowValue(row, WORK_ORDER_KEYS.sku) ?? "").trim();
    const targetRaw = pickRowValue(row, WORK_ORDER_KEYS.target);
    const cycleRaw = pickRowValue(row, WORK_ORDER_KEYS.cycle);

    const targetQty = Number.isFinite(Number(targetRaw)) ? Math.trunc(Number(targetRaw)) : undefined;
    const cycleTime = Number.isFinite(Number(cycleRaw)) ? Number(cycleRaw) : undefined;

    out.push({ workOrderId, sku: sku || undefined, targetQty, cycleTime });
  });

  return out;
}

export default function MachineDetailClient() {
  const { t, locale } = useI18n();
  const params = useParams<{ machineId: string }>();
  const machineId = params?.machineId;

  const [loading, setLoading] = useState(true);
  const [machine, setMachine] = useState<MachineDetail | null>(null);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [cycles, setCycles] = useState<CycleRow[]>([]);
  const [thresholds, setThresholds] = useState<Thresholds | null>(null);
  const [open, setOpen] = useState<null | "events" | "deviation" | "impact">(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [uploadState, setUploadState] = useState<UploadState>({ status: "idle" });

  const BUCKET = {
    normal: {
      labelKey: "machine.detail.bucket.normal",
      dot: "#12D18E",
      glow: "rgba(18,209,142,.35)",
      chip: "bg-emerald-500/15 text-emerald-300 border-emerald-500/20",
    },
    slow: {
      labelKey: "machine.detail.bucket.slow",
      dot: "#F7B500",
      glow: "rgba(247,181,0,.35)",
      chip: "bg-yellow-500/15 text-yellow-300 border-yellow-500/20",
    },
    microstop: {
      labelKey: "machine.detail.bucket.microstop",
      dot: "#FF7A00",
      glow: "rgba(255,122,0,.35)",
      chip: "bg-orange-500/15 text-orange-300 border-orange-500/20",
    },
    macrostop: {
      labelKey: "machine.detail.bucket.macrostop",
      dot: "#FF3B5C",
      glow: "rgba(255,59,92,.35)",
      chip: "bg-rose-500/15 text-rose-300 border-rose-500/20",
    },
    unknown: {
      labelKey: "machine.detail.bucket.unknown",
      dot: "#A1A1AA",
      glow: "rgba(161,161,170,.25)",
      chip: "bg-white/10 text-zinc-200 border-white/10",
    },
  } as const;

  useEffect(() => {
    if (!machineId) return;

    let alive = true;

    async function load() {
      try {
        const res = await fetch(`/api/machines/${machineId}?windowSec=10800`, {
          cache: "no-store",
          credentials: "include",
        });
        const json = await res.json().catch(() => ({}));

        if (!alive) return;

        if (!res.ok || json?.ok === false) {
          setError(json?.error ?? t("machine.detail.error.failed"));
          setLoading(false);
          return;
        }

        setMachine(json.machine ?? null);
        setEvents(json.events ?? []);
        setCycles(json.cycles ?? []);
        setThresholds(json.thresholds ?? null);
        setError(null);
        setLoading(false);
      } catch {
        if (!alive) return;
        setError(t("machine.detail.error.network"));
        setLoading(false);
      }
    }

    load();
    const timer = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [machineId, t]);

  async function parseWorkOrdersFile(file: File) {
    const name = file.name.toLowerCase();
    if (name.endsWith(".csv")) {
      const text = await file.text();
      return rowsToWorkOrders(parseCsvText(text));
    }

    if (name.endsWith(".xls") || name.endsWith(".xlsx")) {
      const buffer = await file.arrayBuffer();
      const xlsx = await import("xlsx");
      const workbook = xlsx.read(buffer, { type: "array" });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      if (!sheet) return [];
      const rows = xlsx.utils.sheet_to_json(sheet, { defval: "" });
      return rowsToWorkOrders(rows as Array<Record<string, any>>);
    }

    return null;
  }

  async function handleWorkOrderUpload(event: any) {
    const file = event?.target?.files?.[0] as File | undefined;
    if (!file) return;

    if (!machineId) {
      setUploadState({ status: "error", message: t("machine.detail.workOrders.uploadError") });
      event.target.value = "";
      return;
    }

    setUploadState({ status: "parsing", message: t("machine.detail.workOrders.uploadParsing") });

    try {
      const workOrders = await parseWorkOrdersFile(file);
      if (!workOrders) {
        setUploadState({ status: "error", message: t("machine.detail.workOrders.uploadInvalid") });
        event.target.value = "";
        return;
      }

      if (!workOrders.length) {
        setUploadState({ status: "error", message: t("machine.detail.workOrders.uploadInvalid") });
        event.target.value = "";
        return;
      }

      setUploadState({ status: "uploading", message: t("machine.detail.workOrders.uploading") });

      const res = await fetch("/api/work-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ machineId, workOrders }),
      });
      const json = await res.json().catch(() => ({}));

      if (!res.ok || json?.ok === false) {
        if (res.status === 401 || res.status === 403) {
          setUploadState({ status: "error", message: t("machine.detail.workOrders.uploadUnauthorized") });
        } else {
          setUploadState({
            status: "error",
            message: json?.error ?? t("machine.detail.workOrders.uploadError"),
          });
        }
        event.target.value = "";
        return;
      }

      setUploadState({
        status: "success",
        message: t("machine.detail.workOrders.uploadSuccess", { count: workOrders.length }),
        count: workOrders.length,
      });
      event.target.value = "";
    } catch {
      setUploadState({ status: "error", message: t("machine.detail.workOrders.uploadError") });
      event.target.value = "";
    }
  }

  const uploadButtonLabel =
    uploadState.status === "parsing"
      ? t("machine.detail.workOrders.uploadParsing")
      : uploadState.status === "uploading"
        ? t("machine.detail.workOrders.uploading")
        : t("machine.detail.workOrders.upload");
  const uploadStatusClass =
    uploadState.status === "success"
      ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/20"
      : uploadState.status === "error"
        ? "bg-red-500/15 text-red-300 border-red-500/20"
        : "bg-white/10 text-zinc-200 border-white/10";
  const isUploading = uploadState.status === "parsing" || uploadState.status === "uploading";

  function fmtPct(v?: number | null) {
    if (v === null || v === undefined || Number.isNaN(v)) return t("common.na");
    return `${v.toFixed(1)}%`;
  }

  function fmtNum(v?: number | null) {
    if (v === null || v === undefined || Number.isNaN(v)) return t("common.na");
    return `${v}`;
  }

  function timeAgo(ts?: string) {
    if (!ts) return t("common.never");
    const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
    if (diff < 60) return rtf.format(-diff, "second");
    if (diff < 3600) return rtf.format(-Math.floor(diff / 60), "minute");
    return rtf.format(-Math.floor(diff / 3600), "hour");
  }

  function isOffline(ts?: string) {
    if (!ts) return true;
    return Date.now() - new Date(ts).getTime() > 30000;
  }

  function normalizeStatus(status?: string) {
    const s = (status ?? "").toUpperCase();
    if (s === "ONLINE") return "RUN";
    return s;
  }

  function statusBadgeClass(status?: string, offline?: boolean) {
    if (offline) return "bg-white/10 text-zinc-300";
    const s = (status ?? "").toUpperCase();
    if (s === "RUN") return "bg-emerald-500/15 text-emerald-300";
    if (s === "IDLE") return "bg-yellow-500/15 text-yellow-300";
    if (s === "STOP" || s === "DOWN") return "bg-red-500/15 text-red-300";
    return "bg-white/10 text-white";
  }

  function severityBadgeClass(sev?: string) {
    const s = (sev ?? "").toLowerCase();
    if (s === "critical") return "bg-red-500/15 text-red-300";
    if (s === "warning") return "bg-yellow-500/15 text-yellow-300";
    return "bg-white/10 text-zinc-200";
  }

  function formatSeverity(severity?: string) {
    if (!severity) return "";
    const key = `overview.severity.${severity.toLowerCase()}`;
    const label = t(key);
    return label === key ? severity.toUpperCase() : label;
  }

  function formatEventType(eventType?: string) {
    if (!eventType) return "";
    const key = `overview.event.${eventType}`;
    const label = t(key);
    return label === key ? eventType : label;
  }

  const hb = machine?.latestHeartbeat ?? null;
  const kpi = machine?.latestKpi ?? null;
  const offline = useMemo(() => isOffline(hb?.ts), [hb?.ts]);
  const normalizedStatus = normalizeStatus(hb?.status);
  const statusLabel = offline
    ? t("machine.detail.status.offline")
    : (() => {
        if (!normalizedStatus) return t("machine.detail.status.unknown");
        const key = `machine.detail.status.${normalizedStatus.toLowerCase()}`;
        const label = t(key);
        return label === key ? normalizedStatus : label;
      })();
  const cycleTarget = (machine as any)?.effectiveCycleTime ?? kpi?.cycleTime ?? null;
  const machineCode = machine?.code ?? t("common.na");
  const machineLocation = machine?.location ?? t("common.na");
  const lastSeenLabel = t("machine.detail.lastSeen", {
    time: hb?.ts ? timeAgo(hb.ts) : t("common.never"),
  });

  const ActiveRing = (props: any) => {
    const { cx, cy, fill } = props;
    if (cx == null || cy == null) return null;
    return (
      <g>
        <circle cx={cx} cy={cy} r={7} fill="transparent" stroke="var(--app-chart-label)" strokeWidth={2} />
        <circle cx={cx} cy={cy} r={4} fill={fill} />
      </g>
    );
  };

  function MiniCard({
    title,
    subtitle,
    value,
    onClick,
  }: {
    title: string;
    subtitle: string;
    value: string;
    onClick?: () => void;
  }) {
    const clickable = typeof onClick === "function";

    if (clickable) {
      return (
        <button
          type="button"
          onClick={onClick}
          className="rounded-2xl border border-white/10 bg-white/5 p-5 text-left transition hover:bg-white/10"
        >
          <div className="text-sm font-semibold text-white">{title}</div>
          <div className="mt-1 text-xs text-zinc-400">{subtitle}</div>
          <div className="mt-4 text-3xl font-semibold text-white">{value}</div>
        </button>
      );
    }

    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-5 text-left">
        <div className="text-sm font-semibold text-white">{title}</div>
        <div className="mt-1 text-xs text-zinc-400">{subtitle}</div>
        <div className="mt-4 text-3xl font-semibold text-white">{value}</div>
      </div>
    );
  }

  function MachineActivityTimeline({
    segments,
    windowSec,
  }: {
    segments: TimelineSeg[];
    windowSec: number;
  }) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm font-semibold text-white">{t("machine.detail.activity.title")}</div>
            <div className="mt-1 text-xs text-zinc-400">{t("machine.detail.activity.subtitle")}</div>
          </div>
          <div className="text-xs text-zinc-400">{windowSec}s</div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-4 text-xs text-zinc-300">
          {(["normal", "slow", "microstop", "macrostop"] as const).map((key) => (
            <div key={key} className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: BUCKET[key].dot }} />
              <span>{t(BUCKET[key].labelKey)}</span>
            </div>
          ))}
        </div>

        <div className="mt-4 rounded-2xl border border-white/10 bg-black/25 p-4">
          <div className="mb-2 flex justify-between text-[11px] text-zinc-500">
            <span>0s</span>
            <span>3h</span>
          </div>

          <div className="flex h-14 w-full overflow-hidden rounded-2xl">
            {segments.length === 0 ? (
              <div className="flex h-full w-full items-center justify-center text-xs text-zinc-400">
                {t("machine.detail.activity.noData")}
              </div>
            ) : (
              segments.map((seg, idx) => {
                const wPct = Math.max(0.25, (seg.durationSec / windowSec) * 100);
                const meta = BUCKET[seg.state];
                const glow =
                  seg.state === "microstop" || seg.state === "macrostop"
                    ? `0 0 22px ${meta.glow}`
                    : `0 0 12px ${meta.glow}`;

                return (
                  <div
                    key={`${seg.start}-${seg.end}-${idx}`}
                    title={`${t(meta.labelKey)}: ${seg.durationSec.toFixed(1)}s`}
                    className="h-full"
                    style={{
                      width: `${wPct}%`,
                      background: meta.dot,
                      boxShadow: glow,
                      opacity: 0.95,
                    }}
                  />
                );
              })
            )}
          </div>
        </div>
      </div>
    );
  }

  function Modal({
    open,
    onClose,
    title,
    children,
  }: {
    open: boolean;
    onClose: () => void;
    title: string;
    children: React.ReactNode;
  }) {
    if (!open) return null;

    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="absolute inset-0 bg-black/70" onClick={onClose} />
        <div className="relative w-full max-w-5xl overflow-hidden rounded-3xl border border-white/10 bg-zinc-950/80 p-6 shadow-2xl backdrop-blur-xl">
          <div
            className="pointer-events-none absolute inset-0 opacity-60"
            style={{
              background:
                "radial-gradient(900px 400px at 20% 10%, rgba(16,185,129,.18), transparent 60%)," +
                "radial-gradient(900px 400px at 85% 30%, rgba(59,130,246,.14), transparent 60%)," +
                "radial-gradient(900px 500px at 50% 100%, rgba(244,63,94,.10), transparent 60%)",
            }}
          />
          <div className="relative">
            <div className="mb-4 flex items-center justify-between">
              <div className="text-lg font-semibold text-white">{title}</div>
              <button
                onClick={onClose}
                className="rounded-lg border border-white/10 bg-white/5 px-3 py-1 text-sm text-white hover:bg-white/10"
              >
                {t("common.close")}
              </button>
            </div>
            {children}
          </div>
        </div>
      </div>
    );
  }

  function CycleTooltip({ active, payload, label }: any) {
    if (!active || !payload?.length) return null;

    const p = payload[0]?.payload;
    if (!p) return null;

    const ideal = p.ideal ?? null;
    const actual = p.actual ?? null;
    const deltaPct = p.deltaPct ?? null;

    return (
      <div className="rounded-xl border border-white/10 bg-zinc-950/95 px-4 py-3 shadow-lg">
        <div className="text-sm font-semibold text-white">
          {t("machine.detail.tooltip.cycle", { label })}
        </div>
        <div className="mt-2 space-y-1 text-xs text-zinc-300">
          <div>
            {t("machine.detail.tooltip.duration")}: <span className="text-white">{actual?.toFixed(2)}s</span>
          </div>
          <div>
            {t("machine.detail.tooltip.ideal")}: <span className="text-white">{ideal != null ? `${ideal.toFixed(2)}s` : t("common.na")}</span>
          </div>
          <div>
            {t("machine.detail.tooltip.deviation")}: <span className="text-white">{deltaPct != null ? `${deltaPct.toFixed(1)}%` : t("common.na")}</span>
          </div>
        </div>
      </div>
    );
  }

  function hasIdealAndActual(
    row: CycleDerivedRow
  ): row is CycleDerivedRow & { ideal: number; actual: number } {
    return row.ideal != null && row.actual != null && row.ideal > 0;
  }

  const cycleDerived = useMemo(() => {
    const rows = cycles ?? [];
    const { micro, macro } = resolveMultipliers(thresholds);

    const mapped: CycleDerivedRow[] = rows.map((cycle) => {
      const ideal = cycle.ideal ?? null;
      const actual = cycle.actual ?? null;
      const extra = ideal != null && actual != null ? actual - ideal : null;

      let bucket: CycleDerivedRow["bucket"] = "unknown";
      if (ideal != null && actual != null) {
        bucket = classifyCycleDuration(actual, ideal, thresholds);
      }

      return { ...cycle, ideal, actual, extra, bucket };
    });

    const counts = mapped.reduce(
      (acc, row) => {
        acc.total += 1;
        acc[row.bucket] += 1;
        if (row.extra != null && row.extra > 0) acc.extraTotal += row.extra;
        return acc;
      },
      { total: 0, normal: 0, slow: 0, microstop: 0, macrostop: 0, unknown: 0, extraTotal: 0 }
    );

    const deltas = mapped.filter(hasIdealAndActual).map((row) => ((row.actual - row.ideal) / row.ideal) * 100);
    const avgDeltaPct = deltas.length ? deltas.reduce((a, b) => a + b, 0) / deltas.length : null;

    return { mapped, counts, avgDeltaPct };
  }, [cycles, thresholds]);

  const deviationSeries = useMemo(() => {
    const last = cycleDerived.mapped.slice(-100);

    return last
      .map((row, idx) => {
        const ideal = row.ideal;
        const actual = row.actual;
        if (ideal == null || actual == null || ideal <= 0) return null;

        const deltaPct = ((actual - ideal) / ideal) * 100;

        return {
          i: idx + 1,
          actual,
          ideal,
          deltaPct,
          bucket: row.bucket,
        };
      })
      .filter(Boolean) as Array<{
      i: number;
      actual: number;
      ideal: number;
      deltaPct: number;
      bucket: string;
    }>;
  }, [cycleDerived.mapped]);

  const impactAgg = useMemo(() => {
    const buckets = { slow: 0, microstop: 0, macrostop: 0 } as Record<string, number>;

    for (const row of cycleDerived.mapped) {
      if (!row.extra || row.extra <= 0) continue;
      if (row.bucket === "slow" || row.bucket === "microstop" || row.bucket === "macrostop") {
        buckets[row.bucket] += row.extra;
      }
    }

    const rows = (["slow", "microstop", "macrostop"] as const).map((bucket) => ({
      bucket,
      label: t(BUCKET[bucket].labelKey),
      seconds: Math.round(buckets[bucket] * 10) / 10,
    }));

    const total = rows.reduce((sum, row) => sum + row.seconds, 0);
    return { rows, total };
  }, [BUCKET, cycleDerived.mapped, t]);

  const timeline = useMemo(() => {
    const rows = cycles ?? [];
    if (rows.length < 1) {
      return {
        windowSec: 10800,
        segments: [] as TimelineSeg[],
        start: null as number | null,
        end: null as number | null,
      };
    }

    const windowSec = 10800;
    const end = rows[rows.length - 1].t;
    const start = end - windowSec * 1000;

    const segs: TimelineSeg[] = [];

    for (const cycle of rows) {
      const ideal = (cycle.ideal ?? cycleTarget ?? 0) as number;
      const actual = cycle.actual ?? 0;
      if (!ideal || ideal <= 0 || !actual || actual <= 0) continue;

      const cycleEnd = cycle.t;
      const cycleStart = cycleEnd - actual * 1000;
      if (cycleEnd <= start || cycleStart >= end) continue;

      const segStart = Math.max(cycleStart, start);
      const segEnd = Math.min(cycleEnd, end);
      if (segEnd <= segStart) continue;

      const state = classifyCycleDuration(actual, ideal, thresholds);



      segs.push({
        start: segStart,
        end: segEnd,
        durationSec: (segEnd - segStart) / 1000,
        state,
      });
    }

    return { windowSec, segments: segs, start, end };
  }, [cycles, cycleTarget, thresholds]);

  const cycleTargetLabel = cycleTarget ? `${cycleTarget}s` : t("common.na");
  const workOrderLabel = kpi?.workOrderId ?? t("common.na");
  const skuLabel = kpi?.sku ?? t("common.na");

  return (
    <div className="p-6">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="truncate text-2xl font-semibold text-white">
              {machine?.name ?? t("machine.detail.titleFallback")}
            </h1>
            <span className={`rounded-full px-3 py-1 text-xs ${statusBadgeClass(normalizedStatus, offline)}`}>
              {statusLabel}
            </span>
          </div>
          <div className="mt-1 text-sm text-zinc-400">
            {machineCode} - {machineLocation} - {lastSeenLabel}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-2">
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,.xls,.xlsx,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={handleWorkOrderUpload}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isUploading}
              className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-100 transition hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {uploadButtonLabel}
            </button>
            <Link
              href="/machines"
              className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white hover:bg-white/10"
            >
              {t("machine.detail.back")}
            </Link>
          </div>
          <div className="text-right text-[11px] text-zinc-500">
            {t("machine.detail.workOrders.uploadHint")}
          </div>
          {uploadState.status !== "idle" && uploadState.message && (
            <div className={`rounded-full border px-3 py-1 text-xs ${uploadStatusClass}`}>
              {uploadState.message}
            </div>
          )}
        </div>
      </div>

      {loading && <div className="text-sm text-zinc-400">{t("machine.detail.loading")}</div>}
      {error && !loading && (
        <div className="rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-sm text-red-200">
          {error}
        </div>
      )}

      {!loading && !error && (
        <>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <div className="text-xs text-zinc-400">OEE</div>
              <div className="mt-2 text-3xl font-bold text-emerald-300">{fmtPct(kpi?.oee)}</div>
              <div className="mt-1 text-xs text-zinc-400">
                {t("machine.detail.kpi.updated", {
                  time: kpi?.ts ? timeAgo(kpi.ts) : t("common.never"),
                })}
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <div className="text-xs text-zinc-400">Availability</div>
              <div className="mt-2 text-2xl font-semibold text-white">{fmtPct(kpi?.availability)}</div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <div className="text-xs text-zinc-400">Performance</div>
              <div className="mt-2 text-2xl font-semibold text-white">{fmtPct(kpi?.performance)}</div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <div className="text-xs text-zinc-400">Quality</div>
              <div className="mt-2 text-2xl font-semibold text-white">{fmtPct(kpi?.quality)}</div>
            </div>
          </div>

          <div className="mt-6">
            <MachineActivityTimeline segments={timeline.segments} windowSec={timeline.windowSec} />
          </div>

          <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-5 xl:col-span-1">
              <div className="mb-3 flex items-center justify-between">
                <div className="text-sm font-semibold text-white">{t("machine.detail.currentWorkOrder")}</div>
                <div className="text-xs text-zinc-400">{workOrderLabel}</div>
              </div>

              <div className="text-xs text-zinc-400">SKU</div>
              <div className="mt-1 text-base font-semibold text-white">{skuLabel}</div>

              <div className="mt-4 grid grid-cols-3 gap-3">
                <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                  <div className="text-[11px] text-zinc-400">{t("overview.target")}</div>
                  <div className="mt-1 text-sm font-semibold text-white">{fmtNum(kpi?.target)}</div>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                  <div className="text-[11px] text-zinc-400">{t("overview.good")}</div>
                  <div className="mt-1 text-sm font-semibold text-white">{fmtNum(kpi?.good)}</div>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                  <div className="text-[11px] text-zinc-400">{t("overview.scrap")}</div>
                  <div className="mt-1 text-sm font-semibold text-white">{fmtNum(kpi?.scrap)}</div>
                </div>
              </div>

              <div className="mt-4 text-xs text-zinc-400">
                {t("machine.detail.cycleTarget")}: <span className="text-white">{cycleTargetLabel}</span>
              </div>
            </div>

            <div className="rounded-2xl border border-white/10 bg-white/5 p-5 xl:col-span-2 flex flex-col">
              <div className="mb-3 flex items-center justify-between">
                <div className="text-sm font-semibold text-white">{t("machine.detail.recentEvents")}</div>
                <div className="text-xs text-zinc-400">
                  {events.length} {t("overview.shown")}
                </div>
              </div>

              {events.length === 0 ? (
                <div className="text-sm text-zinc-400">{t("machine.detail.noEvents")}</div>
              ) : (
                <div className="h-[300px] space-y-3 overflow-y-auto no-scrollbar">
                  {events.map((event) => (
                    <div key={event.id} className="rounded-xl border border-white/10 bg-black/20 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span
                              className={`rounded-full px-2 py-0.5 text-xs ${severityBadgeClass(event.severity)}`}
                            >
                              {formatSeverity(event.severity)}
                            </span>
                            <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-zinc-200">
                              {formatEventType(event.eventType)}
                            </span>
                            {event.requiresAck ? (
                              <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-white">
                                {t("overview.ack")}
                              </span>
                            ) : null}
                          </div>

                          <div className="mt-2 truncate text-sm font-semibold text-white">{event.title}</div>
                          {event.description ? (
                            <div className="mt-1 text-sm text-zinc-300">{event.description}</div>
                          ) : null}
                        </div>

                        <div className="shrink-0 text-xs text-zinc-400">{timeAgo(event.ts)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
            <MiniCard
              title={t("machine.detail.mini.events")}
              subtitle={t("machine.detail.mini.events.subtitle")}
              value={`${cycleDerived.counts.slow + cycleDerived.counts.microstop + cycleDerived.counts.macrostop}`}
              onClick={() => setOpen("events")}
            />
            <MiniCard
              title={t("machine.detail.mini.deviation")}
              subtitle={t("machine.detail.mini.deviation.subtitle")}
              value={cycleDerived.avgDeltaPct == null ? t("common.na") : `${cycleDerived.avgDeltaPct.toFixed(1)}%`}
              onClick={() => setOpen("deviation")}
            />
            <MiniCard
              title={t("machine.detail.mini.impact")}
              subtitle={t("machine.detail.mini.impact.subtitle")}
              value={`${Math.round(cycleDerived.counts.extraTotal)}s`}
              onClick={() => setOpen("impact")}
            />
          </div>

          <Modal open={open === "events"} onClose={() => setOpen(null)} title={t("machine.detail.modal.events")}>
            <div className="max-h-[60vh] space-y-2 overflow-y-auto no-scrollbar">
              {cycleDerived.mapped
                .filter((row) => row.bucket !== "normal" && row.bucket !== "unknown")
                .slice()
                .reverse()
                .map((row, idx) => {
                  const meta = BUCKET[row.bucket as keyof typeof BUCKET];

                  return (
                    <div
                      key={row.t ?? row.ts ?? idx}
                      className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 p-3"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <span
                          className="h-2.5 w-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: meta.dot, boxShadow: `0 0 14px ${meta.glow}` }}
                        />
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={`rounded-full border px-2 py-0.5 text-xs ${meta.chip}`}>
                              {t(meta.labelKey)}
                            </span>
                            <span className="truncate text-sm text-white">
                              {row.actual?.toFixed(2)}s
                              {row.ideal != null ? ` (${t("machine.detail.modal.standardCycle")} ${row.ideal.toFixed(2)}s)` : ""}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="shrink-0 text-xs text-zinc-400">{timeAgo(row.ts)}</div>
                    </div>
                  );
                })}
            </div>
          </Modal>

          <Modal open={open === "deviation"} onClose={() => setOpen(null)} title={t("machine.detail.modal.deviation")}>
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                  <div className="text-xs text-zinc-400">{t("machine.detail.modal.standardCycle")}</div>
                  <div className="mt-2 text-2xl font-semibold text-white">
                    {cycleTarget ? `${Number(cycleTarget).toFixed(1)}s` : t("common.na")}
                  </div>
                </div>

                <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                  <div className="text-xs text-zinc-400">{t("machine.detail.modal.avgDeviation")}</div>
                  <div className="mt-2 text-2xl font-semibold text-white">
                    {cycleDerived.avgDeltaPct == null ? t("common.na") : `${cycleDerived.avgDeltaPct.toFixed(1)}%`}
                  </div>
                </div>

                <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                  <div className="text-xs text-zinc-400">{t("machine.detail.modal.sample")}</div>
                  <div className="mt-2 text-2xl font-semibold text-white">
                    {deviationSeries.length} {t("machine.detail.modal.cycles")}
                  </div>
                </div>
              </div>

              <div
                className="h-[380px] rounded-3xl border border-white/10 bg-black/30 p-4 backdrop-blur"
                style={{ boxShadow: "var(--app-chart-shadow)" }}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={deviationSeries}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--app-chart-grid)" />
                    <XAxis
                      dataKey="i"
                      type="number"
                      domain={[1, "dataMax"]}
                      allowDecimals={false}
                      tick={{ fill: "var(--app-chart-tick)" }}
                    />
                    <YAxis
                      tick={{ fill: "var(--app-chart-tick)" }}
                      domain={
                        kpi?.cycleTime
                          ? [
                              Math.max(0, kpi.cycleTime * (1 - TOL) - 2),
                              kpi.cycleTime * (1 + TOL) + 2,
                            ]
                          : ["auto", "auto"]
                      }
                    />
                    <Tooltip content={<CycleTooltip />} cursor={{ stroke: "var(--app-chart-grid)" }} />

                    {kpi?.cycleTime ? (
                      <>
                        <ReferenceLine y={kpi.cycleTime} stroke="rgba(18,209,142,0.6)" strokeWidth={2} />
                        <ReferenceLine
                          y={kpi.cycleTime * (1 - TOL)}
                          stroke="rgba(247,181,0,0.7)"
                          strokeDasharray="6 6"
                        />
                        <ReferenceLine
                          y={kpi.cycleTime * (1 + TOL)}
                          stroke="rgba(247,181,0,0.7)"
                          strokeDasharray="6 6"
                        />
                      </>
                    ) : null}

                    <Line dataKey="ideal" dot={false} activeDot={false} stroke="var(--app-chart-grid)" />
                    <Scatter
                      dataKey="actual"
                      isAnimationActive={false}
                      activeShape={<ActiveRing />}
                      shape={(props: any) => {
                        const { cx, cy, payload } = props;
                        const meta = BUCKET[payload.bucket as keyof typeof BUCKET] ?? BUCKET.unknown;

                        return (
                          <circle
                            cx={cx}
                            cy={cy}
                            r={5}
                            fill={meta.dot}
                            style={{ filter: `drop-shadow(0 0 8px ${meta.glow})` }}
                          />
                        );
                      }}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              <div className="text-xs text-zinc-400">{t("machine.detail.modal.tip")}</div>
            </div>
          </Modal>

          <Modal open={open === "impact"} onClose={() => setOpen(null)} title={t("machine.detail.modal.impact")}>
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                  <div className="text-xs text-zinc-400">{t("machine.detail.modal.totalExtra")}</div>
                  <div className="mt-2 text-2xl font-semibold text-white">{Math.round(impactAgg.total)}s</div>
                </div>

                <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                  <div className="text-xs text-zinc-400">{t("machine.detail.modal.microstops")}</div>
                  <div className="mt-2 text-2xl font-semibold text-white">
                    {Math.round(impactAgg.rows.find((row) => row.bucket === "microstop")?.seconds ?? 0)}s
                  </div>
                </div>

                <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                  <div className="text-xs text-zinc-400">{t("machine.detail.modal.macroStops")}</div>
                  <div className="mt-2 text-2xl font-semibold text-white">
                    {Math.round(impactAgg.rows.find((row) => row.bucket === "macrostop")?.seconds ?? 0)}s
                  </div>
                </div>
              </div>

              <div
                className="h-[380px] rounded-3xl border border-white/10 bg-black/30 p-4 backdrop-blur"
                style={{ boxShadow: "var(--app-chart-shadow)" }}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={impactAgg.rows}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--app-chart-grid)" />
                    <XAxis dataKey="label" tick={{ fill: "var(--app-chart-tick)" }} />
                    <YAxis tick={{ fill: "var(--app-chart-tick)" }} />
                    <Tooltip
                      shared={false}
                      contentStyle={{
                        background: "var(--app-chart-tooltip-bg)",
                        border: "1px solid var(--app-chart-tooltip-border)",
                      }}
                      labelStyle={{ color: "var(--app-chart-label)" }}
                      formatter={(val: any) => [`${Number(val).toFixed(1)}s`, t("machine.detail.modal.extraTimeLabel")]}
                    />
                    <Bar dataKey="seconds" radius={[10, 10, 0, 0]} isAnimationActive={false}>
                      {impactAgg.rows.map((row, idx) => {
                        const key = row.bucket as keyof typeof BUCKET;
                        return <Cell key={idx} fill={BUCKET[key].dot} />;
                      })}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="text-xs text-zinc-400">{t("machine.detail.modal.extraTimeNote")}</div>
            </div>
          </Modal>
        </>
      )}
    </div>
  );
}
