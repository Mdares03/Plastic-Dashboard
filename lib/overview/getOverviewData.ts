import { prisma } from "@/lib/prisma";
import { normalizeEvent } from "@/lib/events/normalizeEvent";

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

type OrgSettings = {
  stoppageMultiplier?: number | null;
  macroStoppageMultiplier?: number | null;
};

type OverviewParams = {
  orgId: string;
  eventsMode?: string;
  eventsWindowSec?: number;
  eventMachines?: number;
  orgSettings?: OrgSettings | null;
};

function heartbeatTime(hb?: { ts?: Date | null; tsServer?: Date | null } | null) {
  return hb?.tsServer ?? hb?.ts ?? null;
}

export async function getOverviewData({
  orgId,
  eventsMode = "critical",
  eventsWindowSec = 21600,
  eventMachines = 6,
  orgSettings,
}: OverviewParams) {
  const machines = await prisma.machine.findMany({
    where: { orgId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      code: true,
      location: true,
      createdAt: true,
      updatedAt: true,
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

  const machineRows = machines.map((m) => ({
    ...m,
    latestHeartbeat: m.heartbeats[0] ?? null,
    latestKpi: m.kpiSnapshots[0] ?? null,
    heartbeats: undefined,
    kpiSnapshots: undefined,
  }));

  const safeEventMachines = Number.isFinite(eventMachines) ? Math.max(1, Math.floor(eventMachines)) : 6;
  const safeWindowSec = Number.isFinite(eventsWindowSec) ? eventsWindowSec : 21600;

  const topMachines = machineRows
    .slice()
    .sort((a, b) => {
      const at = heartbeatTime(a.latestHeartbeat);
      const bt = heartbeatTime(b.latestHeartbeat);
      const atMs = at ? at.getTime() : 0;
      const btMs = bt ? bt.getTime() : 0;
      return btMs - atMs;
    })
    .slice(0, safeEventMachines);

  const targetIds = topMachines.map((m) => m.id);

  let events = [] as Array<{
    id: string;
    ts: Date | null;
    topic: string;
    eventType: string;
    severity: string;
    title: string;
    description?: string | null;
    requiresAck: boolean;
    workOrderId?: string | null;
    machineId: string;
    machineName?: string | null;
    source: "ingested";
  }>;

  if (targetIds.length) {
    let settings = orgSettings ?? null;
    if (!settings) {
      settings = await prisma.orgSettings.findUnique({
        where: { orgId },
        select: { stoppageMultiplier: true, macroStoppageMultiplier: true },
      });
    }

    const microMultiplier = Number(settings?.stoppageMultiplier ?? 1.5);
    const macroMultiplier = Math.max(microMultiplier, Number(settings?.macroStoppageMultiplier ?? 5));
    const windowStart = new Date(Date.now() - Math.max(0, safeWindowSec) * 1000);

    const rawEvents = await prisma.machineEvent.findMany({
      where: {
        orgId,
        machineId: { in: targetIds },
        ts: { gte: windowStart },
      },
      orderBy: { ts: "desc" },
      take: Math.min(300, Math.max(60, targetIds.length * 40)),
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
        machineId: true,
        machine: { select: { name: true } },
      },
    });

    const normalized = rawEvents
      .map((row) => ({
        ...normalizeEvent(row, { microMultiplier, macroMultiplier }),
        machineId: row.machineId,
        machineName: row.machine?.name ?? null,
        source: "ingested" as const,
      }))
      .filter((event) => event.ts);

    const allowed = normalized.filter((event) => ALLOWED_TYPES.has(event.eventType));
    const isCritical = (event: (typeof allowed)[number]) => {
      const severity = String(event.severity ?? "").toLowerCase();
      return (
        event.eventType === "macrostop" ||
        event.requiresAck === true ||
        severity === "critical" ||
        severity === "error" ||
        severity === "high"
      );
    };

    const filtered = eventsMode === "critical" ? allowed.filter(isCritical) : allowed;

    const seen = new Set<string>();
    const deduped = filtered.filter((event) => {
      const key = `${event.machineId}-${event.eventType}-${event.ts ?? ""}-${event.title}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    deduped.sort((a, b) => {
      const at = a.ts ? a.ts.getTime() : 0;
      const bt = b.ts ? b.ts.getTime() : 0;
      return bt - at;
    });

    events = deduped.slice(0, 30);
  }

  return { machines: machineRows, events };
}
