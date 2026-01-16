import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createHash } from "crypto";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/requireSession";
import { normalizeEvent } from "@/lib/events/normalizeEvent";


export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ machineId: string }> }
) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(_req.url);
  const eventsMode = url.searchParams.get("events") ?? "all";
  const eventsOnly = url.searchParams.get("eventsOnly") === "1";
  const eventsWindowSec = Number(url.searchParams.get("eventsWindowSec") ?? "21600"); // default 6h
  const eventsWindowStart = new Date(Date.now() - Math.max(0, eventsWindowSec) * 1000);
  const windowSec = Number(url.searchParams.get("windowSec") ?? "3600"); // default 1h

  const { machineId } = await params;

  const machineBase = await prisma.machine.findFirst({
    where: { id: machineId, orgId: session.orgId },
    select: { id: true, updatedAt: true },
  });

  if (!machineBase) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  const [heartbeatAgg, kpiAgg, eventAgg, cycleAgg, orgSettingsAgg] = await Promise.all([
    prisma.machineHeartbeat.aggregate({
      where: { orgId: session.orgId, machineId },
      _max: { tsServer: true },
    }),
    prisma.machineKpiSnapshot.aggregate({
      where: { orgId: session.orgId, machineId },
      _max: { tsServer: true },
    }),
    prisma.machineEvent.aggregate({
      where: { orgId: session.orgId, machineId, ts: { gte: eventsWindowStart } },
      _max: { tsServer: true },
    }),
    prisma.machineCycle.aggregate({
      where: { orgId: session.orgId, machineId },
      _max: { ts: true },
    }),
    prisma.orgSettings.findUnique({
      where: { orgId: session.orgId },
      select: { updatedAt: true, stoppageMultiplier: true, macroStoppageMultiplier: true },
    }),
  ]);

  const toMs = (value?: Date | null) => (value ? value.getTime() : 0);
  const lastModifiedMs = Math.max(
    toMs(machineBase.updatedAt),
    toMs(heartbeatAgg._max.tsServer),
    toMs(kpiAgg._max.tsServer),
    toMs(eventAgg._max.tsServer),
    toMs(cycleAgg._max.ts),
    toMs(orgSettingsAgg?.updatedAt)
  );

  const versionParts = [
    session.orgId,
    machineId,
    eventsMode,
    eventsOnly ? "1" : "0",
    eventsWindowSec,
    windowSec,
    toMs(machineBase.updatedAt),
    toMs(heartbeatAgg._max.tsServer),
    toMs(kpiAgg._max.tsServer),
    toMs(eventAgg._max.tsServer),
    toMs(cycleAgg._max.ts),
    toMs(orgSettingsAgg?.updatedAt),
  ];

  const etag = `W/"${createHash("sha1").update(versionParts.join("|")).digest("hex")}"`;
  const lastModified = new Date(lastModifiedMs || 0).toUTCString();
  const responseHeaders = new Headers({
    "Cache-Control": "private, no-cache, max-age=0, must-revalidate",
    ETag: etag,
    "Last-Modified": lastModified,
    Vary: "Cookie",
  });

  const ifNoneMatch = _req.headers.get("if-none-match");
  if (ifNoneMatch && ifNoneMatch === etag) {
    return new NextResponse(null, { status: 304, headers: responseHeaders });
  }

  const ifModifiedSince = _req.headers.get("if-modified-since");
  if (!ifNoneMatch && ifModifiedSince) {
    const since = Date.parse(ifModifiedSince);
    if (!Number.isNaN(since) && lastModifiedMs <= since) {
      return new NextResponse(null, { status: 304, headers: responseHeaders });
    }
  }

  const machine = await prisma.machine.findFirst({
    where: { id: machineId, orgId: session.orgId },
    select: {
      id: true,
      name: true,
      code: true,
      location: true,
      heartbeats: {
        orderBy: { tsServer: "desc" },
        take: 1,
        select: { ts: true, tsServer: true, status: true, message: true, ip: true, fwVersion: true },
      },
      kpiSnapshots: {
        orderBy: { ts: "desc" },
        take: 1,
        select: {
          ts: true,
          oee: true,
          availability: true,
          performance: true,
          quality: true,
          workOrderId: true,
          sku: true,
          good: true,
          scrap: true,
          target: true,
          cycleTime: true,
        },
      },
    },
  });

  if (!machine) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  const microMultiplier = Number(orgSettingsAgg?.stoppageMultiplier ?? 1.5);
  const macroMultiplier = Math.max(
    microMultiplier,
    Number(orgSettingsAgg?.macroStoppageMultiplier ?? 5)
  );

  const rawEvents = await prisma.machineEvent.findMany({
    where: {
      orgId: session.orgId,
      machineId,
      ts: { gte: eventsWindowStart },
    },
    orderBy: { ts: "desc" },
    take: 100, // pull more, we'll filter after normalization
    select: {
      id: true,
      ts: true,
      topic: true,
      eventType: true,
      severity: true,
      title: true,
      description: true,
      requiresAck: true,
      data: true,
      workOrderId: true,
    },
  });

  const normalized = rawEvents.map((row) =>
    normalizeEvent(row, { microMultiplier, macroMultiplier })
  );

  const ALLOWED_TYPES = new Set([
    "slow-cycle",
    "microstop",
    "macrostop",
    "offline",
    "error",
    "oee-drop",
    "quality-spike",
    "performance-degradation",
    "predictive-oee-decline",
    "alert-delivery-failed",
  ]);

  const allEvents = normalized.filter((e) => ALLOWED_TYPES.has(e.eventType));

  const isCritical = (event: (typeof allEvents)[number]) => {
    const severity = String(event.severity ?? "").toLowerCase();
    return (
      event.eventType === "macrostop" ||
      event.requiresAck === true ||
      severity === "critical" ||
      severity === "error" ||
      severity === "high"
    );
  };

  const eventsFiltered = eventsMode === "critical" ? allEvents.filter(isCritical) : allEvents;
  const events = eventsFiltered.slice(0, 30);
  const eventsCountAll = allEvents.length;
  const eventsCountCritical = allEvents.filter(isCritical).length;

  if (eventsOnly) {
    return NextResponse.json(
      { ok: true, events, eventsCountAll, eventsCountCritical },
      { headers: responseHeaders }
    );
  }


// ---- cycles window ----

const latestKpi = machine.kpiSnapshots[0] ?? null;

// If KPI cycleTime missing, fallback to DB cycles (we fetch 1 first)
const latestCycleForIdeal = await prisma.machineCycle.findFirst({
  where: { orgId: session.orgId, machineId },
  orderBy: { ts: "desc" },
  select: { theoreticalCycleTime: true },
});

const effectiveCycleTime =
  latestKpi?.cycleTime ??
  latestCycleForIdeal?.theoreticalCycleTime ??
  null;

// Estimate how many cycles we need to cover the window.
// Add buffer so the chart doesn’t look “tight”.
const estCycleSec = Math.max(1, Number(effectiveCycleTime ?? 14));
const needed = Math.ceil(windowSec / estCycleSec) + 50;

// Safety cap to avoid crazy payloads
const takeCycles = Math.min(1000, Math.max(200, needed));

const rawCycles = await prisma.machineCycle.findMany({
  where: { orgId: session.orgId, machineId },
  orderBy: { ts: "desc" },
  take: takeCycles,
  select: {
    ts: true,
    cycleCount: true,
    actualCycleTime: true,
    theoreticalCycleTime: true,
    workOrderId: true,
    sku: true,
  },
});
const latestCycle = rawCycles[0] ?? null;

let activeStoppage: {
  state: "microstop" | "macrostop";
  startedAt: string;
  durationSec: number;
  theoreticalCycleTime: number;
} | null = null;

if (latestCycle?.ts && effectiveCycleTime && effectiveCycleTime > 0) {
  const elapsedSec = (Date.now() - latestCycle.ts.getTime()) / 1000;
  const microThresholdSec = effectiveCycleTime * microMultiplier;
  const macroThresholdSec = effectiveCycleTime * macroMultiplier;

  if (elapsedSec >= microThresholdSec) {
    const isMacro = elapsedSec >= macroThresholdSec;
    const state = isMacro ? "macrostop" : "microstop";
    const thresholdSec = isMacro ? macroThresholdSec : microThresholdSec;
    const startedAtMs = latestCycle.ts.getTime() + thresholdSec * 1000;

    activeStoppage = {
      state,
      startedAt: new Date(startedAtMs).toISOString(),
      durationSec: Math.max(0, Math.floor(elapsedSec - thresholdSec)),
      theoreticalCycleTime: effectiveCycleTime,
    };
  }
}

// chart-friendly: oldest -> newest + numeric timestamps
const cycles = rawCycles
  .slice()
  .reverse()
  .map((c) => ({
    ts: c.ts,
    t: c.ts.getTime(),
    cycleCount: c.cycleCount ?? null,
    actual: c.actualCycleTime,
    ideal: c.theoreticalCycleTime ?? null,
    workOrderId: c.workOrderId ?? null,
    sku: c.sku ?? null,
  }));
  return NextResponse.json(
    {
      ok: true,
      machine: {
        id: machine.id,
        name: machine.name,
        code: machine.code,
        location: machine.location,
        latestHeartbeat: machine.heartbeats[0] ?? null,
        latestKpi: machine.kpiSnapshots[0] ?? null,
        effectiveCycleTime,
      },
      thresholds: {
        stoppageMultiplier: microMultiplier,
        macroStoppageMultiplier: macroMultiplier,
      },
      activeStoppage,
      events,
      eventsCountAll,
      eventsCountCritical,
      cycles,
    },
    { headers: responseHeaders }
  );
}
