import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/requireSession";
import { logLine } from "@/lib/logger";
import { elapsedMs, formatServerTiming, nowMs, PERF_LOGS_ENABLED } from "@/lib/perf/serverTiming";

let reportsFiltersColdStart = true;

function getColdStartInfo() {
  const coldStart = reportsFiltersColdStart;
  reportsFiltersColdStart = false;
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

  const baseWhere = {
    orgId: session.orgId,
    ...(machineId ? { machineId } : {}),
    ts: { gte: start, lte: end },
  };

  if (perfEnabled) timings.preQuery = elapsedMs(preQueryStart);

  const versionStart = nowMs();
  const cycleMax = await prisma.machineCycle.aggregate({
    where: baseWhere,
    _max: { tsServer: true },
  });
  if (perfEnabled) timings.version = elapsedMs(versionStart);

  const versionParts = [
    session.orgId,
    range,
    machineId ?? "",
    toMs(cycleMax._max.tsServer),
  ];
  const etag = `W/"${createHash("sha1").update(versionParts.join("|")).digest("hex")}"`;
  const responseHeaders = new Headers({
    "Cache-Control": "private, no-cache, max-age=0, must-revalidate",
    ETag: etag,
    "Last-Modified": new Date(toMs(cycleMax._max.tsServer) || 0).toUTCString(),
    Vary: "Cookie",
  });

  const ifNoneMatch = req.headers.get("if-none-match");
  if (ifNoneMatch && ifNoneMatch === etag) {
    return new NextResponse(null, { status: 304, headers: responseHeaders });
  }

  const workOrdersStart = nowMs();
  const workOrderRows = await prisma.machineCycle.findMany({
    where: { ...baseWhere, workOrderId: { not: null } },
    distinct: ["workOrderId"],
    select: { workOrderId: true },
  });
  if (perfEnabled) timings.workOrders = elapsedMs(workOrdersStart);

  const skuStart = nowMs();
  const skuRows = await prisma.machineCycle.findMany({
    where: { ...baseWhere, sku: { not: null } },
    distinct: ["sku"],
    select: { sku: true },
  });
  if (perfEnabled) timings.skus = elapsedMs(skuStart);

  const postQueryStart = nowMs();

  const workOrders = workOrderRows.map((r) => r.workOrderId).filter(Boolean) as string[];
  const skus = skuRows.map((r) => r.sku).filter(Boolean) as string[];

  const payload = { ok: true, workOrders, skus };

  if (perfEnabled) {
    timings.postQuery = elapsedMs(postQueryStart);
    timings.total = elapsedMs(totalStart);
    responseHeaders.set("Server-Timing", formatServerTiming(timings));
    const payloadBytes = Buffer.byteLength(JSON.stringify(payload));
    logLine("perf.reports.filters", {
      orgId: session.orgId,
      coldStart,
      uptimeMs,
      range,
      machineId,
      timings,
      rowCounts: {
        workOrderRows: workOrderRows.length,
        skuRows: skuRows.length,
      },
      payloadBytes,
    });
  }

  return NextResponse.json(payload, { headers: responseHeaders });
}
