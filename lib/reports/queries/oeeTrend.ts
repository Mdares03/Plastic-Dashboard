import { prisma } from "@/lib/prisma";

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
    },
  });

  const agg = new Map<string, { sum: number; count: number }>();
  for (const row of rows) {
    if (typeof row.oee !== "number" || !Number.isFinite(row.oee)) continue;
    const key = getDayKey(row.ts, timeZone);
    const prev = agg.get(key) ?? { sum: 0, count: 0 };
    prev.sum += row.oee;
    prev.count += 1;
    agg.set(key, prev);
  }

  const keys = dayRangeKeys(from, to, timeZone);
  return keys.map((date) => {
    const point = agg.get(date);
    return {
      date,
      oee: point && point.count > 0 ? Math.max(0, Math.min(100, point.sum / point.count)) : 0,
      target: targetPct,
    };
  });
}
