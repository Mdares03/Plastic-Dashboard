import { prisma } from "@/lib/prisma";
import { normalizeEvent } from "@/lib/events/normalizeEvent";
import { logLine } from "@/lib/logger";
import { elapsedMs, nowMs, PERF_LOGS_ENABLED } from "@/lib/perf/serverTiming";
import type { OverviewEventRow, OverviewMachineRow } from "@/lib/overview/types";
import {
  fetchLatestHeartbeats,
  fetchLatestKpis,
  fetchMachineBase,
  mergeMachineOverviewRows,
} from "@/lib/machines/withLatest";

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
}: OverviewParams): Promise<{ machines: OverviewMachineRow[]; events: OverviewEventRow[] }> {
  const perfEnabled = PERF_LOGS_ENABLED;
  const timings: Record<string, number> = {};
  const totalStart = nowMs();

  try {
    const machinesStart = nowMs();
    const machines = await fetchMachineBase(orgId);
    if (perfEnabled) timings.machinesQuery = elapsedMs(machinesStart);

    const heartbeatStart = nowMs();
    const machineIds = machines.map((machine) => machine.id);
    const heartbeats = await fetchLatestHeartbeats(orgId, machineIds);
    if (perfEnabled) timings.heartbeatsQuery = elapsedMs(heartbeatStart);

    const kpiStart = nowMs();
    const kpis = await fetchLatestKpis(orgId, machineIds);
    if (perfEnabled) timings.kpiQuery = elapsedMs(kpiStart);

    const machineRows: OverviewMachineRow[] = mergeMachineOverviewRows({
      machines,
      heartbeats,
      kpis,
      includeKpi: true,
    });

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

    let events: OverviewEventRow[] = [];

    if (targetIds.length) {
      let settings = orgSettings ?? null;
      if (!settings) {
        const settingsStart = nowMs();
        settings = await prisma.orgSettings.findUnique({
          where: { orgId },
          select: { stoppageMultiplier: true, macroStoppageMultiplier: true },
        });
        if (perfEnabled) timings.orgSettingsQuery = elapsedMs(settingsStart);
      }

      const microMultiplier = Number(settings?.stoppageMultiplier ?? 1.5);
      const macroMultiplier = Math.max(microMultiplier, Number(settings?.macroStoppageMultiplier ?? 5));
      const windowStart = new Date(Date.now() - Math.max(0, safeWindowSec) * 1000);

      const eventsStart = nowMs();
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
      if (perfEnabled) timings.eventsQuery = elapsedMs(eventsStart);

      const normalizeStart = nowMs();
      const normalized = rawEvents
        .map((row) => ({
          ...normalizeEvent(row, { microMultiplier, macroMultiplier }),
          machineId: row.machineId,
          machineName: row.machine?.name ?? null,
          source: "ingested" as const,
        }))
        .filter((event) => event.ts);
      if (perfEnabled) timings.eventsNormalize = elapsedMs(normalizeStart);

      const filterStart = nowMs();
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
      if (perfEnabled) timings.eventsFilter = elapsedMs(filterStart);
    }

    if (perfEnabled) {
      timings.total = elapsedMs(totalStart);
      logLine("perf.overview.getOverviewData", {
        orgId,
        eventsMode,
        eventsWindowSec,
        eventMachines,
        timings,
        counts: {
          machines: machineRows.length,
          events: events.length,
          targetMachines: targetIds.length,
        },
      });
    }

    return { machines: machineRows, events };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    if (perfEnabled) {
      timings.total = elapsedMs(totalStart);
      logLine("perf.overview.getOverviewData.error", {
        orgId,
        eventsMode,
        eventsWindowSec,
        eventMachines,
        timings,
        message,
        stack,
      });
    }
    logLine("getOverviewData.error", { message, stack });
    console.error("[getOverviewData]", err);
    return { machines: [], events: [] };
  }
}
