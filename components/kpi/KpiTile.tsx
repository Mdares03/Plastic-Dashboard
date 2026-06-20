"use client";

/**
 * Shared KPI tile — one presentation for every screen, so a metric always carries
 * the SAME label, and, crucially, a caption that states WHICH number it is: a live
 * snapshot ("En vivo") or a time-window average ("Hoy", "Últimos 7 días"). Two screens
 * showing 82 % and 75 % for "OEE" are not in conflict when one is labeled live and the
 * other a window average — this caption is what stops that from reading as a bug.
 *
 * When there is no value, an explicit emptyCaption (e.g. "sin datos en vivo") replaces
 * the ambiguous bare "—".
 */

type Tone = "primary" | "neutral";

export type KpiTileProps = {
  label: string;
  /** Pre-formatted value, e.g. "82.0%". null/undefined/"—" all render as no-data. */
  value: string | null | undefined;
  /** Mode + freshness line shown under the value when present (e.g. "En vivo · hace 2 min"). */
  caption?: string;
  /** Shown instead of caption when there is no value (e.g. "sin datos en vivo (>10 min)"). */
  emptyCaption?: string;
  tone?: Tone;
};

export default function KpiTile({ label, value, caption, emptyCaption, tone = "neutral" }: KpiTileProps) {
  const hasValue = value != null && value !== "" && value !== "—";
  const valueClass = !hasValue ? "text-zinc-500" : tone === "primary" ? "text-emerald-300" : "text-white";
  const valueSize = tone === "primary" ? "text-3xl" : "text-2xl";

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
      <div className="text-xs text-zinc-400">{label}</div>
      <div className={`mt-2 ${valueSize} font-semibold ${valueClass}`}>{hasValue ? value : "—"}</div>
      {hasValue && caption ? (
        <div className="mt-1 text-[11px] uppercase tracking-wide text-zinc-500">{caption}</div>
      ) : null}
      {!hasValue && emptyCaption ? <div className="mt-1 text-[11px] text-zinc-500">{emptyCaption}</div> : null}
    </div>
  );
}
