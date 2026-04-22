import { logLine } from "@/lib/logger";
import { elapsedMs, nowMs, PERF_LOGS_ENABLED } from "@/lib/perf/serverTiming";
import type { OverviewMachineRow } from "@/lib/overview/types";
import {
  fetchLatestHeartbeats,
  fetchMachineBase,
  mergeMachineOverviewRows,
} from "@/lib/machines/withLatest";

type OverviewSummaryParams = {
  orgId: string;
};

const SUMMARY_CACHE_TTL_MS = 10000;
const summaryCache = new Map<string, { value: OverviewMachineRow[]; expiresAt: number; cachedAt: number }>();
const summaryInFlight = new Map<string, Promise<{ machines: OverviewMachineRow[] }>>();

export async function getOverviewSummary({
  orgId,
}: OverviewSummaryParams): Promise<{ machines: OverviewMachineRow[] }> {
  const now = Date.now();
  const cached = summaryCache.get(orgId);
  if (cached && cached.expiresAt > now) {
    if (PERF_LOGS_ENABLED) {
      logLine("perf.overview.summary", {
        orgId,
        cached: true,
        timings: { total: 0 },
        ageMs: now - cached.cachedAt,
        counts: { machines: cached.value.length },
      });
    }
    return { machines: cached.value };
  }

  const inFlight = summaryInFlight.get(orgId);
  if (inFlight) return inFlight;

  const promise = fetchOverviewSummary({ orgId })
    .then((result) => {
      summaryCache.set(orgId, {
        value: result.machines,
        cachedAt: now,
        expiresAt: now + SUMMARY_CACHE_TTL_MS,
      });
      summaryInFlight.delete(orgId);
      return result;
    })
    .catch((err) => {
      summaryInFlight.delete(orgId);
      throw err;
    });

  summaryInFlight.set(orgId, promise);
  return promise;
}

async function fetchOverviewSummary({
  orgId,
}: OverviewSummaryParams): Promise<{ machines: OverviewMachineRow[] }> {
  const perfEnabled = PERF_LOGS_ENABLED;
  const totalStart = nowMs();
  const timings: Record<string, number> = {};

  try {
    const machinesStart = nowMs();
    const machines = await fetchMachineBase(orgId);
    if (perfEnabled) timings.machinesQuery = elapsedMs(machinesStart);

    const heartbeatStart = nowMs();
    const machineIds = machines.map((machine) => machine.id);
    const heartbeats = await fetchLatestHeartbeats(orgId, machineIds);
    if (perfEnabled) timings.heartbeatsQuery = elapsedMs(heartbeatStart);

    const machineRows: OverviewMachineRow[] = mergeMachineOverviewRows({
      machines,
      heartbeats,
      includeKpi: false,
    });

    if (perfEnabled) {
      timings.total = elapsedMs(totalStart);
      logLine("perf.overview.summary", {
        orgId,
        timings,
        counts: { machines: machineRows.length },
      });
    }

    return { machines: machineRows };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    if (perfEnabled) {
      timings.total = elapsedMs(totalStart);
      logLine("perf.overview.summary.error", { orgId, timings, message, stack });
    }
    logLine("getOverviewSummary.error", { message, stack });
    console.error("[getOverviewSummary]", err);
    return { machines: [] };
  }
}
