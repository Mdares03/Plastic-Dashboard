import { prisma } from "@/lib/prisma";
import { MAX_SAMPLE_WEIGHT_MS, weightedRate, type KpiSample } from "@/lib/metrics";

function getDayKey(date: Date, timeZone: string) {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const year = parts.find((p) => p.type === "year")?.value ?? "0000";
    const month = parts.find((p) => p.type === "month")?.value ?? "01";
    const day = parts.find((p) => p.type === "day")?.value ?? "01";
    return `${year}-${month}-${day}`;
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

function dayRangeKeys(from: Date, to: Date, timeZone: string) {
  const out: string[] = [];
  const cursor = new Date(from);
  cursor.setUTCHours(0, 0, 0, 0);
  const end = new Date(to);
  end.setUTCHours(0, 0, 0, 0);
  while (cursor <= end) {
    out.push(getDayKey(cursor, timeZone));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return Array.from(new Set(out));
}

export async function getOeeTrend7d(params: {
  orgId: string;
  from: Date;
  to: Date;
  machineIds: string[];
  targetPct: number;
  timeZone: string;
}) {
  const { orgId, from, to, machineIds, targetPct, timeZone } = params;
  if (!machineIds.length) return [];

  const rows = await prisma.machineKpiSnapshot.findMany({
    where: {
      orgId,
      machineId: { in: machineIds },
      ts: { gte: from, lte: to },
      trackingEnabled: true,
      productionStarted: true,
    },
    select: {
      ts: true,
      oee: true,
      availability: true,
      performance: true,
      quality: true,
    },
  });

  // R4 — each day's OEE is the time-weighted average of that day's production
  // snapshots (the recap method), not a plain sum/count. R7 — a day with no
  // production samples is a *null* gap, never 0 (a 0 fakes a collapse to the eye
  // and poisons any downstream average). Completes the half-deployed trend fix.
  const samplesByDay = new Map<string, KpiSample[]>();
  for (const row of rows) {
    const key = getDayKey(row.ts, timeZone);
    const list = samplesByDay.get(key) ?? [];
    list.push({
      ts: row.ts,
      oee: row.oee,
      availability: row.availability,
      performance: row.performance,
      quality: row.quality,
      trackingEnabled: true, // query already filtered to production samples
      productionStarted: true,
    });
    samplesByDay.set(key, list);
  }

  const keys = dayRangeKeys(from, to, timeZone);
  return keys.map((date) => {
    const samples = samplesByDay.get(date) ?? [];
    let oee: number | null = null;
    if (samples.length) {
      const lastTs = samples.reduce((m, s) => Math.max(m, s.ts.getTime()), 0);
      // windowEnd bounds the final sample's (capped) weight within the day.
      oee = weightedRate(samples, "oee", new Date(lastTs + MAX_SAMPLE_WEIGHT_MS));
    }
    return { date, oee, target: targetPct };
  });
}
