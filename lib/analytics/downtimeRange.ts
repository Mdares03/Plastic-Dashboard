export const DOWNTIME_RANGES = ["24h", "7d", "30d", "mtd"] as const;
export type DowntimeRange = (typeof DOWNTIME_RANGES)[number];

export function coerceDowntimeRange(v?: string | null): DowntimeRange {
  const s = (v ?? "").toLowerCase();
  return (DOWNTIME_RANGES as readonly string[]).includes(s) ? (s as DowntimeRange) : "7d";
}

// server-friendly helper
export function rangeToStart(range: DowntimeRange) {
  const now = new Date();
  if (range === "24h") return new Date(Date.now() - 24 * 60 * 60 * 1000);
  if (range === "30d") return new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  if (range === "mtd") return new Date(now.getFullYear(), now.getMonth(), 1);
  return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
}

// UI label helper (replaces ternaries everywhere)
export const DOWNTIME_RANGE_LABEL: Record<DowntimeRange, string> = {
  "24h": "Last 24h",
  "7d": "Last 7d",
  "30d": "Last 30d",
  "mtd": "MTD",
};
