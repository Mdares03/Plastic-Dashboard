type FormatElapsedOptions = {
  maxUnits?: number;
  minUnit?: "second" | "minute";
};

const UNIT_SECONDS = {
  day: 86400,
  hour: 3600,
  minute: 60,
  second: 1,
} as const;

function normalizeSeconds(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.floor(value));
}

function formatParts(totalSeconds: number, options?: FormatElapsedOptions) {
  const maxUnits = Math.max(1, Math.floor(options?.maxUnits ?? 2));
  const minUnit = options?.minUnit ?? "second";

  const units: Array<{ key: keyof typeof UNIT_SECONDS; label: string }> = [
    { key: "day", label: "d" },
    { key: "hour", label: "h" },
    { key: "minute", label: "min" },
  ];

  if (minUnit === "second") {
    units.push({ key: "second", label: "s" });
  }

  let remaining = normalizeSeconds(totalSeconds);
  const parts: string[] = [];

  for (const unit of units) {
    const unitSeconds = UNIT_SECONDS[unit.key];
    const value = Math.floor(remaining / unitSeconds);
    if (value > 0) {
      parts.push(`${value}${unit.label}`);
      remaining -= value * unitSeconds;
    }
    if (parts.length >= maxUnits) break;
  }

  if (parts.length) return parts.join(" ");
  return minUnit === "minute" ? "0min" : "0s";
}

export function formatElapsedFromSeconds(
  seconds: number | null | undefined,
  options?: FormatElapsedOptions
) {
  return formatParts(normalizeSeconds(seconds), options);
}

export function formatElapsedFromMinutes(
  minutes: number | null | undefined,
  options?: Omit<FormatElapsedOptions, "minUnit">
) {
  if (minutes == null || !Number.isFinite(minutes)) return "0min";
  const seconds = Math.max(0, Math.floor(minutes * 60));
  return formatParts(seconds, { ...options, minUnit: "minute" });
}

export function formatElapsedSince(
  timestamp: string | undefined,
  fallback: string,
  options?: FormatElapsedOptions
) {
  if (!timestamp) return fallback;
  const diffSeconds = Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000);
  if (!Number.isFinite(diffSeconds)) return fallback;
  return formatParts(Math.max(0, diffSeconds), options);
}

export function formatElapsedSinceWithAgo(
  timestamp: string | undefined,
  locale: string,
  fallback: string,
  options?: FormatElapsedOptions
) {
  const elapsed = formatElapsedSince(timestamp, fallback, options);
  if (elapsed === fallback) return fallback;
  const lower = locale.toLowerCase();
  if (lower.startsWith("es")) return `hace ${elapsed}`;
  return `${elapsed} ago`;
}
