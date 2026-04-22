import { performance } from "perf_hooks";

export const PERF_LOGS_ENABLED = process.env.PERF_LOGS === "1";

export function nowMs() {
  return performance.now();
}

export function elapsedMs(startMs: number) {
  return Math.round((performance.now() - startMs) * 100) / 100;
}

export function formatServerTiming(entries: Record<string, number>) {
  return Object.entries(entries)
    .filter(([, value]) => Number.isFinite(value))
    .map(([name, value]) => `${name};dur=${value.toFixed(1)}`)
    .join(", ");
}
