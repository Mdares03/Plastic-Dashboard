import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/requireSession";
import { logLine } from "@/lib/logger";
import { elapsedMs, formatServerTiming, nowMs, PERF_LOGS_ENABLED } from "@/lib/perf/serverTiming";

let reportsColdStart = true;

function getColdStartInfo() {
  const coldStart = reportsColdStart;
  reportsColdStart = false;
  return { coldStart, uptimeMs: Math.round(process.uptime() * 1000) };
}

const RANGE_MS: Record<string, number> = {
  "24h": 24 * 60 * 60 * 1000,
  "7d": 7 * 24 * 60 * 60 * 1000,
  "30d": 30 * 24 * 60 * 60 * 1000,
};

function parseDate(input?: string | null) {
  if (!input) return null;
  const n = Number(input);
  if (!Number.isNaN(n)) return new Date(n);
  const d = new Date(input);
  return Number.isNaN(d.getTime()) ? null : d;
}

function pickRange(req: NextRequest) {
  const url = new URL(req.url);
  const range = url.searchParams.get("range") ?? "24h";
  const now = new Date();

  if (range === "custom") {
    const start = parseDate(url.searchParams.get("start")) ?? new Date(now.getTime() - RANGE_MS["24h"]);
    const end = parseDate(url.searchParams.get("end")) ?? now;
    return { start, end };
  }

  const ms = RANGE_MS[range] ?? RANGE_MS["24h"];
  return { start: new Date(now.getTime() - ms), end: now };
}

function safeNum(v: unknown) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function isProductionSnapshot(trackingEnabled: unknown, productionStarted: unknown) {
  return trackingEnabled === true && productionStarted === true;
}

function toMs(value?: Date | null) {
  return value ? value.getTime() : 0;
}

export async function GET(req: NextRequest) {
  const perfEnabled = PERF_LOGS_ENABLED;
  const totalStart = nowMs();
  const timings: Record<string, number> = {};
  const { coldStart, uptimeMs } = getColdStartInfo();

  const authStart = nowMs();
  const session = await requireSession();
  if (perfEnabled) timings.auth = elapsedMs(authStart);
  if (!session) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const preQueryStart = nowMs();
  const url = new URL(req.url);
  const range = url.searchParams.get("range") ?? "24h";
  const machineId = url.searchParams.get("machineId") ?? undefined;
  const { start, end } = pickRange(req);
  const workOrderId = url.searchParams.get("workOrderId") ?? undefined;
  const sku = url.searchParams.get("sku") ?? undefined;
  const baseWhere = {
    orgId: session.orgId,
    ...(machineId ? { machineId } : {}),
    ...(workOrderId ? { workOrderId } : {}),
    ...(sku ? { sku } : {}),
  };

  if (perfEnabled) timings.preQuery = elapsedMs(preQueryStart);

  const versionStart = nowMs();
  const [kpiMax, cycleMax, eventMax] = await Promise.all([
    prisma.machineKpiSnapshot.aggregate({
      where: { ...baseWhere, ts: { gte: start, lte: end } },
      _max: { tsServer: true },
    }),
    prisma.machineCycle.aggregate({
      where: { ...baseWhere, ts: { gte: start, lte: end } },
      _max: { tsServer: true },
    }),
    prisma.machineEvent.aggregate({
      where: { ...baseWhere, ts: { gte: start, lte: end } },
      _max: { tsServer: true },
    }),
  ]);
  if (perfEnabled) timings.version = elapsedMs(versionStart);

  const lastModifiedMs = Math.max(
    toMs(kpiMax._max.tsServer),
    toMs(cycleMax._max.tsServer),
    toMs(eventMax._max.tsServer)
  );

  const versionParts = [
    session.orgId,
    range,
    machineId ?? "",
    workOrderId ?? "",
    sku ?? "",
    toMs(kpiMax._max.tsServer),
    toMs(cycleMax._max.tsServer),
    toMs(eventMax._max.tsServer),
  ];
  const etag = `W/"${createHash("sha1").update(versionParts.join("|")).digest("hex")}"`;
  const responseHeaders = new Headers({
    "Cache-Control": "private, no-cache, max-age=0, must-revalidate",
    ETag: etag,
    "Last-Modified": new Date(lastModifiedMs || 0).toUTCString(),
    Vary: "Cookie",
  });

  const ifNoneMatch = req.headers.get("if-none-match");
  if (ifNoneMatch && ifNoneMatch === etag) {
    return new NextResponse(null, { status: 304, headers: responseHeaders });
  }

  const kpiStart = nowMs();
  const kpiRows = await prisma.machineKpiSnapshot.findMany({
    where: { ...baseWhere, ts: { gte: start, lte: end } },
    orderBy: { ts: "asc" },
    select: {
      ts: true,
      oee: true,
      availability: true,
      performance: true,
      quality: true,
      good: true,
      scrap: true,
      target: true,
      trackingEnabled: true,
      productionStarted: true,
      machineId: true,
    },
  });
  if (perfEnabled) timings.kpiRows = elapsedMs(kpiStart);

  let oeeSum = 0;
  let oeeCount = 0;
  let availSum = 0;
  let availCount = 0;
  let perfSum = 0;
  let perfCount = 0;
  let qualSum = 0;
  let qualCount = 0;

  // OEE-family summaries are production-only to avoid mixing downtime/off windows.
  for (const k of kpiRows) {
    if (!isProductionSnapshot(k.trackingEnabled, k.productionStarted)) continue;
    if (safeNum(k.oee) != null) {
      oeeSum += Number(k.oee);
      oeeCount += 1;
    }
    if (safeNum(k.availability) != null) {
      availSum += Number(k.availability);
      availCount += 1;
    }
    if (safeNum(k.performance) != null) {
      perfSum += Number(k.performance);
      perfCount += 1;
    }
    if (safeNum(k.quality) != null) {
      qualSum += Number(k.quality);
      qualCount += 1;
    }
  }

  const cyclesStart = nowMs();
  const cycles = await prisma.machineCycle.findMany({
    where: { ...baseWhere, ts: { gte: start, lte: end } },
    select: { goodDelta: true, scrapDelta: true },
  });
  if (perfEnabled) timings.cycles = elapsedMs(cyclesStart);

  let goodTotal = 0;
  let scrapTotal = 0;

  for (const c of cycles) {
    if (safeNum(c.goodDelta) != null) goodTotal += Number(c.goodDelta);
    if (safeNum(c.scrapDelta) != null) scrapTotal += Number(c.scrapDelta);
  }

  const kpiAggStart = nowMs();
  const kpiAgg = await prisma.machineKpiSnapshot.groupBy({
    by: ["machineId"],
    where: { ...baseWhere, ts: { gte: start, lte: end } },
    _max: { good: true, scrap: true, target: true },
    _min: { good: true, scrap: true },
    _count: { _all: true },
  });
  if (perfEnabled) timings.kpiAgg = elapsedMs(kpiAggStart);

  let targetTotal = 0;
  if (goodTotal === 0 && scrapTotal === 0) {
    let goodFallback = 0;
    let scrapFallback = 0;

    for (const row of kpiAgg) {
      const count = row._count._all ?? 0;
      const maxGood = safeNum(row._max.good);
      const minGood = safeNum(row._min.good);
      const maxScrap = safeNum(row._max.scrap);
      const minScrap = safeNum(row._min.scrap);

      if (count > 1 && maxGood != null && minGood != null) {
        goodFallback += Math.max(0, maxGood - minGood);
      } else if (maxGood != null) {
        goodFallback += maxGood;
      }

      if (count > 1 && maxScrap != null && minScrap != null) {
        scrapFallback += Math.max(0, maxScrap - minScrap);
      } else if (maxScrap != null) {
        scrapFallback += maxScrap;
      }
    }

    goodTotal = goodFallback;
    scrapTotal = scrapFallback;
  }

  for (const row of kpiAgg) {
    const maxTarget = safeNum(row._max.target);
    if (maxTarget != null) targetTotal += maxTarget;
  }

  const eventsStart = nowMs();
  const events = await prisma.machineEvent.findMany({
    where: { ...baseWhere, ts: { gte: start, lte: end } },
    select: { eventType: true, data: true },
  });
  if (perfEnabled) timings.events = elapsedMs(eventsStart);

  let macrostopSec = 0;
  let microstopSec = 0;
  let slowCycleCount = 0;
  let qualitySpikeCount = 0;
  let performanceDegradationCount = 0;
  let oeeDropCount = 0;

  for (const e of events) {
    const type = String(e.eventType ?? "").toLowerCase();
    let blob: unknown = e.data;

    if (typeof blob === "string") {
      try {
        blob = JSON.parse(blob);
      } catch {
        blob = null;
      }
    }

    const blobRecord = typeof blob === "object" && blob !== null ? (blob as Record<string, unknown>) : null;
    const innerCandidate = blobRecord?.data ?? blobRecord ?? {};
    const inner =
      typeof innerCandidate === "object" && innerCandidate !== null
        ? (innerCandidate as Record<string, unknown>)
        : {};
    const stopSec =
      (typeof inner?.stoppage_duration_seconds === "number" && inner.stoppage_duration_seconds) ||
      (typeof inner?.stop_duration_seconds === "number" && inner.stop_duration_seconds) ||
      0;

    if (type === "macrostop") macrostopSec += Number(stopSec) || 0;
    else if (type === "microstop") microstopSec += Number(stopSec) || 0;
    else if (type === "slow-cycle") slowCycleCount += 1;
    else if (type === "quality-spike") qualitySpikeCount += 1;
    else if (type === "performance-degradation") performanceDegradationCount += 1;
    else if (type === "oee-drop") oeeDropCount += 1;
  }

  type TrendPoint = { t: string; v: number | null };

  const trend: {
    oee: TrendPoint[];
    availability: TrendPoint[];
    performance: TrendPoint[];
    quality: TrendPoint[];
    scrapRate: TrendPoint[];
  } = {
    oee: [],
    availability: [],
    performance: [],
    quality: [],
    scrapRate: [],
  };

   type TsBucket = {
    oeeSum: number; oeeCount: number;
    availSum: number; availCount: number;
    perfSum: number; perfCount: number;
    qualSum: number; qualCount: number;
    goodSum: number; scrapSum: number;
    anyProduction: boolean;
  };
  const tsBuckets = new Map<string, TsBucket>();

  for (const k of kpiRows) {
    const t = k.ts.toISOString();
    let b = tsBuckets.get(t);
    if (!b) {
      b = {
        oeeSum: 0, oeeCount: 0,
        availSum: 0, availCount: 0,
        perfSum: 0, perfCount: 0,
        qualSum: 0, qualCount: 0,
        goodSum: 0, scrapSum: 0,
        anyProduction: false,
      };
      tsBuckets.set(t, b);
    }

    const isProd = isProductionSnapshot(k.trackingEnabled, k.productionStarted);
    if (isProd) {
      b.anyProduction = true;
      const oee = safeNum(k.oee);
      if (oee != null) { b.oeeSum += Number(oee); b.oeeCount += 1; }
      const avail = safeNum(k.availability);
      if (avail != null) { b.availSum += Number(avail); b.availCount += 1; }
      const perf = safeNum(k.performance);
      if (perf != null) { b.perfSum += Number(perf); b.perfCount += 1; }
      const qual = safeNum(k.quality);
      if (qual != null) { b.qualSum += Number(qual); b.qualCount += 1; }
    }

    const good = safeNum(k.good);
    const scrap = safeNum(k.scrap);
    if (good != null) b.goodSum += Number(good);
    if (scrap != null) b.scrapSum += Number(scrap);
  }

  // Iterate sorted ts. kpiRows already orderBy ts asc, but Map insertion
  // order matches that, so spreading keys preserves order.
  for (const [t, b] of tsBuckets) {
    if (!b.anyProduction) {
      // No machine producing at this ts -> gap, same as before.
      trend.oee.push({ t, v: null });
      trend.availability.push({ t, v: null });
      trend.performance.push({ t, v: null });
      trend.quality.push({ t, v: null });
    } else {
      trend.oee.push({ t, v: b.oeeCount ? b.oeeSum / b.oeeCount : null });
      trend.availability.push({ t, v: b.availCount ? b.availSum / b.availCount : null });
      trend.performance.push({ t, v: b.perfCount ? b.perfSum / b.perfCount : null });
      trend.quality.push({ t, v: b.qualCount ? b.qualSum / b.qualCount : null });
    }
    const total = b.goodSum + b.scrapSum;
    if (total > 0) {
      trend.scrapRate.push({ t, v: (b.scrapSum / total) * 100 });
    }
  }
  const cycleRowsStart = nowMs();
  const cycleRows = await prisma.machineCycle.findMany({
    where: { ...baseWhere, ts: { gte: start, lte: end } },
    select: { actualCycleTime: true },
  });
  if (perfEnabled) timings.cycleRows = elapsedMs(cycleRowsStart);

  const values = cycleRows
    .map((c) => Number(c.actualCycleTime))
    .filter((v) => Number.isFinite(v) && v > 0)
    .sort((a, b) => a - b);

  let cycleTimeBins: {
    label: string;
    count: number;
    rangeStart?: number;
    rangeEnd?: number;
    overflow?: "low" | "high";
    minValue?: number;
    maxValue?: number;
  }[] = [];

  if (values.length) {
    const pct = (p: number) => {
      const idx = Math.max(0, Math.min(values.length - 1, Math.floor(p * (values.length - 1))));
      return values[idx];
    };

    const p5 = pct(0.05);
    const p95 = pct(0.95);

    const inRange = values.filter((v) => v >= p5 && v <= p95);
    const low = values.filter((v) => v < p5);
    const high = values.filter((v) => v > p95);

    const binCount = 10;
    const span = Math.max(0.1, p95 - p5);
    const step = span / binCount;

    const counts = new Array(binCount).fill(0);
    for (const v of inRange) {
      const idx = Math.min(binCount - 1, Math.floor((v - p5) / step));
      counts[idx] += 1;
    }
    const decimals = step < 0.1 ? 2 : step < 1 ? 1 : 0;

    cycleTimeBins = counts.map((count, i) => {
      const a = p5 + step * i;
      const b = p5 + step * (i + 1);
      return {
        label: `${a.toFixed(decimals)}-${b.toFixed(decimals)}s`,
        count,
        rangeStart: a,
        rangeEnd: b,
      };
    });
    

    if (low.length) {
      cycleTimeBins.unshift({
        label: `< ${p5.toFixed(1)}s`,
        count: low.length,
        rangeEnd: p5,
        overflow: "low",
        minValue: low[0],
        maxValue: low[low.length - 1],
      });
    }

    if (high.length) {
      cycleTimeBins.push({
        label: `> ${p95.toFixed(1)}s`,
        count: high.length,
        rangeStart: p95,
        overflow: "high",
        minValue: high[0],
        maxValue: high[high.length - 1],
      });
    }
  }
  const scrapRate =
    goodTotal + scrapTotal > 0 ? (scrapTotal / (goodTotal + scrapTotal)) * 100 : null;



  // top scrap SKU / work order (from cycles)
  const scrapBySku = new Map<string, number>();
  const scrapByWo = new Map<string, number>();

  const scrapRowsStart = nowMs();
  const scrapRows = await prisma.machineCycle.findMany({
    where: { ...baseWhere, ts: { gte: start, lte: end } },
    select: { sku: true, workOrderId: true, scrapDelta: true },
  });
  if (perfEnabled) timings.scrapRows = elapsedMs(scrapRowsStart);

  const postQueryStart = nowMs();

  for (const row of scrapRows) {
    const scrap = safeNum(row.scrapDelta);
    if (scrap == null || scrap <= 0) continue;
    if (row.sku) scrapBySku.set(row.sku, (scrapBySku.get(row.sku) ?? 0) + scrap);
    if (row.workOrderId) scrapByWo.set(row.workOrderId, (scrapByWo.get(row.workOrderId) ?? 0) + scrap);
  }

  const topScrapSku = [...scrapBySku.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const topScrapWorkOrder = [...scrapByWo.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

  const oeeAvg = oeeCount ? oeeSum / oeeCount : null;
  const availabilityAvg = availCount ? availSum / availCount : null;
  const performanceAvg = perfCount ? perfSum / perfCount : null;
  const qualityAvg = qualCount ? qualSum / qualCount : null;

  // insights
  const insights: string[] = [];
  if (scrapRate != null && scrapRate > 5) insights.push(`Scrap rate is ${scrapRate.toFixed(1)}% (above 5%).`);
  if (performanceAvg != null && performanceAvg < 85) insights.push("Performance below 85%.");
  if (availabilityAvg != null && availabilityAvg < 85) insights.push("Availability below 85%.");
  if (oeeAvg != null && oeeAvg < 85) insights.push("OEE below 85%.");
  if (macrostopSec > 1800) insights.push("Macrostop time exceeds 30 minutes in this range.");



  const payload = {
    ok: true,
    summary: {
      oeeAvg,
      availabilityAvg,
      performanceAvg,
      qualityAvg,
      goodTotal,
      scrapTotal,
      targetTotal,
      scrapRate,
      topScrapSku,
      topScrapWorkOrder,
    },

    downtime: {
      macrostopSec,
      microstopSec,
      slowCycleCount,
      qualitySpikeCount,
      performanceDegradationCount,
      oeeDropCount,
    },
    trend,
    insights,
    distribution: {
      cycleTime: cycleTimeBins,
    },
  };

  if (perfEnabled) {
    timings.postQuery = elapsedMs(postQueryStart);
    timings.total = elapsedMs(totalStart);
    responseHeaders.set("Server-Timing", formatServerTiming(timings));
    const payloadBytes = Buffer.byteLength(JSON.stringify(payload));
    logLine("perf.reports.api", {
      orgId: session.orgId,
      coldStart,
      uptimeMs,
      range,
      machineId,
      workOrderId,
      sku,
      timings,
      rowCounts: {
        kpiRows: kpiRows.length,
        cycles: cycles.length,
        events: events.length,
        cycleRows: cycleRows.length,
        scrapRows: scrapRows.length,
      },
      payloadBytes,
    });
  }

  return NextResponse.json(payload, { headers: responseHeaders });
}
