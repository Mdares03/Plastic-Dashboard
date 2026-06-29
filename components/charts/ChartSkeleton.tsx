/**
 * Placeholder shown while a Recharts-backed chart is lazy-loaded (next/dynamic).
 * Recharts + d3 is ~315KB of client JS, so every chart is code-split and only
 * fetched when it's about to render; this keeps a sized, non-shifting box in the
 * meantime. `heightClass` should match the chart's container height to avoid
 * layout shift when the real chart swaps in.
 */
export default function ChartSkeleton({
  heightClass = "h-64",
  className = "",
}: {
  heightClass?: string;
  className?: string;
}) {
  return (
    <div
      className={`w-full animate-pulse rounded-xl border border-white/10 bg-white/5 ${heightClass} ${className}`}
      aria-hidden="true"
    />
  );
}
