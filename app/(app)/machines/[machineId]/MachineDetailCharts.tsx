"use client";

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
import { BUCKET, TOL } from "./machineDetailBuckets";

/**
 * Recharts-backed charts for the machine detail modals (cycle deviation + extra-
 * time impact), split into their own module so Recharts (~315KB w/ d3) is
 * code-split and loaded via next/dynamic only when a modal opens — not in the
 * page's initial bundle. BUCKET/TOL live in the recharts-free
 * ./machineDetailBuckets so the page can share them without pulling Recharts in.
 */

type Translator = (key: string, vars?: Record<string, string | number>) => string;

type ActiveRingProps = { cx?: number; cy?: number; fill?: string };
type ScatterPointProps = { cx?: number; cy?: number; payload?: { bucket?: string } };
type CycleTooltipPayload = {
  payload?: { actual?: number; ideal?: number; deltaPct?: number };
};

const ActiveRing = ({ cx, cy, fill }: ActiveRingProps) => {
  if (cx == null || cy == null) return null;
  return (
    <g>
      <circle cx={cx} cy={cy} r={7} fill="transparent" stroke="var(--app-chart-label)" strokeWidth={2} />
      <circle cx={cx} cy={cy} r={4} fill={fill} />
    </g>
  );
};

export type CycleDeviationPoint = {
  i: number;
  actual: number;
  ideal: number;
  deltaPct: number;
  bucket: string;
};

export function CycleDeviationChart({
  data,
  cycleTime,
  t,
}: {
  data: CycleDeviationPoint[];
  cycleTime?: number | null;
  t: Translator;
}) {
  function CycleTooltip({
    active,
    payload,
    label,
  }: {
    active?: boolean;
    payload?: CycleTooltipPayload[];
    label?: string | number;
  }) {
    if (!active || !payload?.length) return null;
    const p = payload[0]?.payload;
    if (!p) return null;
    const safeLabel = label ?? "";
    const ideal = p.ideal ?? null;
    const actual = p.actual ?? null;
    const deltaPct = p.deltaPct ?? null;

    return (
      <div className="rounded-xl border border-white/10 bg-zinc-950/95 px-4 py-3 shadow-lg">
        <div className="text-sm font-semibold text-white">
          {t("machine.detail.tooltip.cycle", { label: safeLabel })}
        </div>
        <div className="mt-2 space-y-1 text-xs text-zinc-300">
          <div>
            {t("machine.detail.tooltip.duration")}: <span className="text-white">{actual?.toFixed(2)}s</span>
          </div>
          <div>
            {t("machine.detail.tooltip.ideal")}:{" "}
            <span className="text-white">{ideal != null ? `${ideal.toFixed(2)}s` : t("common.na")}</span>
          </div>
          <div>
            {t("machine.detail.tooltip.deviation")}:{" "}
            <span className="text-white">{deltaPct != null ? `${deltaPct.toFixed(1)}%` : t("common.na")}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%" minHeight={200}>
      <ComposedChart data={data}>
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
            cycleTime
              ? [Math.max(0, cycleTime * (1 - TOL) - 2), cycleTime * (1 + TOL) + 2]
              : ["auto", "auto"]
          }
        />
        <Tooltip content={<CycleTooltip />} cursor={{ stroke: "var(--app-chart-grid)" }} />

        {cycleTime ? (
          <>
            <ReferenceLine y={cycleTime} stroke="rgba(18,209,142,0.6)" strokeWidth={2} />
            <ReferenceLine y={cycleTime * (1 - TOL)} stroke="rgba(247,181,0,0.7)" strokeDasharray="6 6" />
            <ReferenceLine y={cycleTime * (1 + TOL)} stroke="rgba(247,181,0,0.7)" strokeDasharray="6 6" />
          </>
        ) : null}

        <Line dataKey="ideal" dot={false} activeDot={false} stroke="var(--app-chart-grid)" isAnimationActive={false} />
        <Scatter
          dataKey="actual"
          isAnimationActive={false}
          activeShape={<ActiveRing />}
          shape={({ cx, cy, payload }: ScatterPointProps) => {
            const meta = BUCKET[(payload?.bucket as keyof typeof BUCKET) ?? "unknown"] ?? BUCKET.unknown;
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
  );
}

export type ImpactRow = { bucket: string; label: string; seconds: number };

export function ImpactChart({ rows, t }: { rows: ImpactRow[]; t: Translator }) {
  return (
    <ResponsiveContainer width="100%" height="100%" minHeight={200}>
      <BarChart data={rows}>
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
          formatter={(val: unknown) => [
            `${val == null ? 0 : Number(val).toFixed(1)}s`,
            t("machine.detail.modal.extraTimeLabel"),
          ]}
        />
        <Bar dataKey="seconds" radius={[10, 10, 0, 0]} isAnimationActive={false}>
          {rows.map((row, idx) => {
            const key = row.bucket as keyof typeof BUCKET;
            return <Cell key={idx} fill={(BUCKET[key] ?? BUCKET.unknown).dot} />;
          })}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
