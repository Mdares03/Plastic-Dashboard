import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/requireSession";
import { getOverviewData } from "@/lib/overview/getOverviewData";
import { getOverviewSummary } from "@/lib/overview/getOverviewSummary";
import { logLine } from "@/lib/logger";
import { elapsedMs, formatServerTiming, nowMs, PERF_LOGS_ENABLED } from "@/lib/perf/serverTiming";

let overviewColdStart = true;

function getColdStartInfo() {
  const coldStart = overviewColdStart;
  overviewColdStart = false;
  return { coldStart, uptimeMs: Math.round(process.uptime() * 1000) };
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
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const detail = url.searchParams.get("detail") === "1";

  if (!detail) {
    const summaryStart = nowMs();
    const { machines: machineRows } = await getOverviewSummary({ orgId: session.orgId });
    if (perfEnabled) timings.summary = elapsedMs(summaryStart);

    const payload = { ok: true, machines: machineRows, events: [] };
    const responseHeaders = new Headers();
    if (perfEnabled) {
      timings.total = elapsedMs(totalStart);
      responseHeaders.set("Server-Timing", formatServerTiming(timings));
      const payloadBytes = Buffer.byteLength(JSON.stringify(payload));
      logLine("perf.overview.api", {
        orgId: session.orgId,
        detail: false,
        coldStart,
        uptimeMs,
        timings,
        counts: { machines: machineRows.length, events: 0 },
        payloadBytes,
      });
    }

    return NextResponse.json(payload, { headers: responseHeaders });
  }

  const preQueryStart = nowMs();
  const eventsMode = url.searchParams.get("events") ?? "critical";
  const eventsWindowSecRaw = Number(url.searchParams.get("eventsWindowSec") ?? "21600");
  const eventsWindowSec = Number.isFinite(eventsWindowSecRaw) ? eventsWindowSecRaw : 21600;
  const eventMachinesRaw = Number(url.searchParams.get("eventMachines") ?? "6");
  const eventMachines = Number.isFinite(eventMachinesRaw) ? Math.max(1, eventMachinesRaw) : 6;
  if (perfEnabled) timings.preQuery = elapsedMs(preQueryStart);

  const aggStart = nowMs();
  const [machineAgg, heartbeatAgg, kpiAgg, eventAgg, orgSettings] = await Promise.all([
    prisma.machine.aggregate({
      where: { orgId: session.orgId },
      _max: { updatedAt: true },
    }),
    prisma.machineHeartbeat.aggregate({
      where: { orgId: session.orgId },
      _max: { tsServer: true },
    }),
    prisma.machineKpiSnapshot.aggregate({
      where: { orgId: session.orgId },
      _max: { tsServer: true },
    }),
    prisma.machineEvent.aggregate({
      where: { orgId: session.orgId },
      _max: { tsServer: true },
    }),
    prisma.orgSettings.findUnique({
      where: { orgId: session.orgId },
      select: { updatedAt: true, stoppageMultiplier: true, macroStoppageMultiplier: true },
    }),
  ]);
  if (perfEnabled) timings.agg = elapsedMs(aggStart);

  const lastModifiedMs = Math.max(
    toMs(machineAgg._max.updatedAt),
    toMs(heartbeatAgg._max.tsServer),
    toMs(kpiAgg._max.tsServer),
    toMs(eventAgg._max.tsServer),
    toMs(orgSettings?.updatedAt)
  );

  const versionParts = [
    session.orgId,
    eventsMode,
    eventsWindowSec,
    eventMachines,
    toMs(machineAgg._max.updatedAt),
    toMs(heartbeatAgg._max.tsServer),
    toMs(kpiAgg._max.tsServer),
    toMs(eventAgg._max.tsServer),
    toMs(orgSettings?.updatedAt),
  ];

  const etag = `W/"${createHash("sha1").update(versionParts.join("|")).digest("hex")}"`;
  const lastModified = new Date(lastModifiedMs || 0).toUTCString();
  const responseHeaders = new Headers({
    "Cache-Control": "private, no-cache, max-age=0, must-revalidate",
    ETag: etag,
    "Last-Modified": lastModified,
    Vary: "Cookie",
  });

  const ifNoneMatch = req.headers.get("if-none-match");
  if (ifNoneMatch && ifNoneMatch === etag) {
    return new NextResponse(null, { status: 304, headers: responseHeaders });
  }

  const ifModifiedSince = req.headers.get("if-modified-since");
  if (!ifNoneMatch && ifModifiedSince) {
    const since = Date.parse(ifModifiedSince);
    if (!Number.isNaN(since) && lastModifiedMs <= since) {
      return new NextResponse(null, { status: 304, headers: responseHeaders });
    }
  }

  const dataStart = nowMs();
  const { machines: machineRows, events } = await getOverviewData({
    orgId: session.orgId,
    eventsMode,
    eventsWindowSec,
    eventMachines,
    orgSettings,
  });
  if (perfEnabled) timings.data = elapsedMs(dataStart);

  const postQueryStart = nowMs();

  const payload = { ok: true, machines: machineRows, events };
  if (perfEnabled) {
    timings.postQuery = elapsedMs(postQueryStart);
    timings.total = elapsedMs(totalStart);
    responseHeaders.set("Server-Timing", formatServerTiming(timings));
    const payloadBytes = Buffer.byteLength(JSON.stringify(payload));
    logLine("perf.overview.api", {
      orgId: session.orgId,
      detail: true,
      coldStart,
      uptimeMs,
      eventsMode,
      eventsWindowSec,
      eventMachines,
      timings,
      counts: { machines: machineRows.length, events: events.length },
      payloadBytes,
    });
  }

  return NextResponse.json(payload, { headers: responseHeaders });
}
