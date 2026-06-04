import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/requireSession";
import { normalizeEvent } from "@/lib/events/normalizeEvent";
import { invalidateMachineAuth } from "@/lib/machineAuthCache";
import { RECAP_HEARTBEAT_STALE_MS } from "@/lib/recap/recapUiConstants";
import type { MachinePulseState } from "@/lib/machines/rowPulse";

const machineIdSchema = z.string().uuid();

// Freshness windows for "is this incident still ongoing?" — mirrors recap
// (lib/recap/redesign.ts detectActiveEpisode / getRecapData mold detection).
const STOP_ACTIVE_STALE_MS = 2 * 60 * 1000;
const MOLD_ACTIVE_STALE_MS = 12 * 60 * 60 * 1000;

function eventDataObject(data: unknown): Record<string, unknown> {
  let parsed: unknown = data;
  if (typeof parsed === "string") {
    try { parsed = JSON.parse(parsed); } catch { parsed = null; }
  }
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

function isTruthyFlag(value: unknown) {
  return value === true || value === "true";
}

/**
 * Returns the start (ms) of the freshest still-active incident of `type`, or
 * null. Groups by incidentKey, ignores auto-ack/update refresh pings, treats a
 * "resolved" final status as ended, and drops episodes older than `staleMs`.
 */
function activeEpisodeStartMs(
  rows: ReadonlyArray<{ eventType: string | null; ts: Date; data: unknown }>,
  type: string,
  nowMs: number,
  staleMs: number,
): number | null {
  const episodes = new Map<string, { firstTsMs: number; lastTsMs: number; lastStatus: string }>();
  for (const row of rows) {
    if (String(row.eventType || "").toLowerCase() !== type) continue;
    const data = eventDataObject(row.data);
    if (isTruthyFlag(data.is_auto_ack) || isTruthyFlag(data.isAutoAck)) continue;
    if (isTruthyFlag(data.is_update) || isTruthyFlag(data.isUpdate)) continue;
    const status = String(data.status ?? "").trim().toLowerCase();
    const incidentKey =
      String(data.incidentKey ?? data.incident_key ?? "").trim() || `${type}:${row.ts.getTime()}`;
    const tsMs = row.ts.getTime();
    const existing = episodes.get(incidentKey);
    if (!existing) {
      episodes.set(incidentKey, { firstTsMs: tsMs, lastTsMs: tsMs, lastStatus: status });
      continue;
    }
    existing.firstTsMs = Math.min(existing.firstTsMs, tsMs);
    if (tsMs >= existing.lastTsMs) {
      existing.lastTsMs = tsMs;
      existing.lastStatus = status;
    }
  }
  let bestStart: number | null = null;
  let bestTs = -Infinity;
  for (const ep of episodes.values()) {
    if (ep.lastStatus === "resolved") continue; // ended
    if (nowMs - ep.lastTsMs > staleMs) continue; // stale → assume ended
    if (ep.lastTsMs > bestTs) {
      bestTs = ep.lastTsMs;
      bestStart = ep.firstTsMs;
    }
  }
  return bestStart;
}

const ALLOWED_EVENT_TYPES = new Set([
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

function canManageMachines(role?: string | null) {
  return role === "OWNER" || role === "ADMIN";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function parseNumber(value: string | null, fallback: number) {
  if (value == null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

type MachineFkReference = {
  tableName: string;
  columnName: string;
  deleteRule: string;
};

function quoteIdent(identifier: string) {
  return `"${identifier.replace(/"/g, "\"\"")}"`;
}

async function cleanupMachineReferences(machineId: string) {
  const refs = await prisma.$queryRaw<MachineFkReference[]>`
    SELECT DISTINCT
      tc.table_name AS "tableName",
      kcu.column_name AS "columnName",
      rc.delete_rule AS "deleteRule"
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
     AND tc.table_schema = kcu.table_schema
    JOIN information_schema.referential_constraints rc
      ON tc.constraint_name = rc.constraint_name
     AND tc.table_schema = rc.constraint_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
      AND rc.unique_constraint_schema = 'public'
      AND rc.unique_constraint_name IN (
        SELECT constraint_name
        FROM information_schema.table_constraints
        WHERE table_schema = 'public'
          AND table_name = 'Machine'
          AND constraint_type IN ('PRIMARY KEY', 'UNIQUE')
      )
  `;

  for (const ref of refs) {
    if (ref.tableName === "Machine") continue;
    const table = quoteIdent(ref.tableName);
    const column = quoteIdent(ref.columnName);
    const rule = String(ref.deleteRule ?? "").toUpperCase();

    if (rule === "CASCADE") continue;

    if (rule === "SET NULL") {
      await prisma.$executeRawUnsafe(`UPDATE ${table} SET ${column} = NULL WHERE ${column} = $1`, machineId);
      continue;
    }

    await prisma.$executeRawUnsafe(`DELETE FROM ${table} WHERE ${column} = $1`, machineId);
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ machineId: string }> }) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { machineId } = await params;
  if (!machineIdSchema.safeParse(machineId).success) {
    return NextResponse.json({ ok: false, error: "Invalid machine id" }, { status: 400 });
  }

  const url = new URL(req.url);
  const windowSec = Math.max(0, parseNumber(url.searchParams.get("windowSec"), 3600));
  const eventsWindowSec = Math.max(0, parseNumber(url.searchParams.get("eventsWindowSec"), 21600));
  const eventsMode = url.searchParams.get("events") ?? "critical";
  const eventsOnly = url.searchParams.get("eventsOnly") === "1";

  const [machineRow, orgSettings, machineSettings] = await Promise.all([
    prisma.machine.findFirst({
      where: { id: machineId, orgId: session.orgId },
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
    }),
    prisma.orgSettings.findUnique({
      where: { orgId: session.orgId },
      select: { stoppageMultiplier: true, macroStoppageMultiplier: true },
    }),
    prisma.machineSettings.findUnique({
      where: { machineId },
      select: { overridesJson: true },
    }),
  ]);

  if (!machineRow) {
    return NextResponse.json({ ok: false, error: "Machine not found" }, { status: 404 });
  }

  const overrides = isPlainObject(machineSettings?.overridesJson) ? machineSettings?.overridesJson : {};
  const thresholdsOverride = isPlainObject(overrides.thresholds) ? overrides.thresholds : {};
  const stoppageMultiplier =
    typeof thresholdsOverride.stoppageMultiplier === "number"
      ? thresholdsOverride.stoppageMultiplier
      : Number(orgSettings?.stoppageMultiplier ?? 1.5);
  const macroStoppageMultiplier =
    typeof thresholdsOverride.macroStoppageMultiplier === "number"
      ? thresholdsOverride.macroStoppageMultiplier
      : Number(orgSettings?.macroStoppageMultiplier ?? 5);

  const thresholds = {
    stoppageMultiplier,
    macroStoppageMultiplier,
  };

  const machine = {
    ...machineRow,
    effectiveCycleTime: null,
    latestHeartbeat: machineRow.heartbeats[0] ?? null,
    latestKpi: machineRow.kpiSnapshots[0] ?? null,
    heartbeats: undefined,
    kpiSnapshots: undefined,
  };

  const cycles = eventsOnly
    ? []
    : await prisma.machineCycle.findMany({
        where: {
          orgId: session.orgId,
          machineId,
          ts: { gte: new Date(Date.now() - windowSec * 1000) },
        },
        orderBy: { ts: "asc" },
        select: {
          ts: true,
          tsServer: true,
          cycleCount: true,
          actualCycleTime: true,
          theoreticalCycleTime: true,
          workOrderId: true,
          sku: true,
        },
      });

  const cyclesOut = cycles.map((row) => {
    const ts = row.tsServer ?? row.ts;
    return {
      ts,
      t: ts.getTime(),
      cycleCount: row.cycleCount ?? null,
      actual: row.actualCycleTime,
      ideal: row.theoreticalCycleTime ?? null,
      workOrderId: row.workOrderId ?? null,
      sku: row.sku ?? null,
    };
  });

  const eventWindowStart = new Date(Date.now() - eventsWindowSec * 1000);
  const criticalSeverities = ["critical", "error", "high"];
  const eventWhereBase = {
    orgId: session.orgId,
    machineId,
    ts: { gte: eventWindowStart },
  };

  const [rawEvents, eventsCountAll] = await Promise.all([
    prisma.machineEvent.findMany({
      where: eventWhereBase,
      orderBy: { ts: "desc" },
      take: eventsOnly ? 300 : 120,
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
    }),
    prisma.machineEvent.count({ where: eventWhereBase }),
  ]);

  const normalized = rawEvents.map((row) =>
    normalizeEvent(row, { microMultiplier: stoppageMultiplier, macroMultiplier: macroStoppageMultiplier })
  );

  const allowed = normalized.filter((event) => ALLOWED_EVENT_TYPES.has(event.eventType));
  const criticalEventTypes = new Set(["macrostop", "microstop", "slow-cycle", "offline", "error"]);
  const filtered =
    eventsMode === "critical"
      ? allowed.filter((event) => {
          const severity = String(event.severity ?? "").toLowerCase();
          return (
            criticalEventTypes.has(event.eventType) ||
            event.requiresAck === true ||
            criticalSeverities.includes(severity)
          );
        })
      : allowed;

  // Build a lookup of raw event metadata (incidentKey, status, is_auto_ack)
  // by event id, so we can collapse the normalized events down to one
  // "active" + one "resolved" per incident.
  const rawMetaById = new Map<string, { incidentKey: string | null; status: string | null; isAutoAck: boolean }>();
  for (const row of rawEvents) {
    let parsed: unknown = row.data;
    if (typeof parsed === "string") {
      try { parsed = JSON.parse(parsed); } catch { parsed = null; }
    }
    const data: Record<string, unknown> =
      parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as Record<string, unknown>)
        : {};
    const isAutoAck =
      data.is_auto_ack === true ||
      data.isAutoAck === true ||
      data.is_auto_ack === "true" ||
      data.isAutoAck === "true";
    const incidentKey =
      typeof data.incidentKey === "string" ? data.incidentKey :
      typeof data.incident_key === "string" ? data.incident_key : null;
    const status = typeof data.status === "string" ? data.status.toLowerCase() : null;
    rawMetaById.set(row.id, { incidentKey, status, isAutoAck });
  }

  // Drop pure auto-ack refresh pings.
  const filteredNoAutoAck = filtered.filter((event) => {
    const meta = rawMetaById.get(event.id);
    return !meta?.isAutoAck;
  });

  // Group by incidentKey: keep at most one "active" (oldest = original happen)
  // and one "resolved" (newest = actual end) per incident. Events without
  // incidentKey pass through unchanged (mold-change, edge-case events).
  const byGroup = new Map<string, typeof filteredNoAutoAck[number]>();
  const passthrough: typeof filteredNoAutoAck = [];

  for (const event of filteredNoAutoAck) {
    const meta = rawMetaById.get(event.id);
    const groupId = meta?.incidentKey;
    if (!groupId) {
      passthrough.push(event);
      continue;
    }
    const statusKey = meta.status === "resolved" ? "resolved" : "active";
    const key = `${groupId}:${statusKey}`;
    const existing = byGroup.get(key);
    if (!existing) {
      byGroup.set(key, event);
      continue;
    }
    const existingTs = existing.ts ? existing.ts.getTime() : 0;
    const eventTs = event.ts ? event.ts.getTime() : 0;
    const pickNewest = statusKey === "resolved";
    const shouldReplace = pickNewest ? eventTs > existingTs : eventTs < existingTs;
    if (shouldReplace) byGroup.set(key, event);
  }

  const deduped = [...passthrough, ...byGroup.values()];
  deduped.sort((a, b) => {
    const at = a.ts ? a.ts.getTime() : 0;
    const bt = b.ts ? b.ts.getTime() : 0;
    return bt - at;
  });

  // Derive the machine's current state so list views can pulse the row in the
  // matching color (blue mold-change, red stop, orange microstop, dark idle).
  // Precedence mirrors recap: offline > mold-change > stopped > microstop > running > idle.
  const nowMs = Date.now();
  const hbTs = machine.latestHeartbeat?.tsServer ?? machine.latestHeartbeat?.ts ?? null;
  const hbStatus = String(machine.latestHeartbeat?.status ?? "").toUpperCase();
  const offline = !hbTs || nowMs - new Date(hbTs).getTime() > RECAP_HEARTBEAT_STALE_MS;

  const moldStartMs = activeEpisodeStartMs(rawEvents, "mold-change", nowMs, MOLD_ACTIVE_STALE_MS);
  // A mold change is over once production resumes after it started.
  const moldOngoing = moldStartMs != null && !cyclesOut.some((c) => c.t > moldStartMs);
  const macroActive = activeEpisodeStartMs(rawEvents, "macrostop", nowMs, STOP_ACTIVE_STALE_MS) != null;
  const microActive =
    activeEpisodeStartMs(rawEvents, "microstop", nowMs, STOP_ACTIVE_STALE_MS) != null ||
    activeEpisodeStartMs(rawEvents, "slow-cycle", nowMs, STOP_ACTIVE_STALE_MS) != null;
  const lastCycleMs = cyclesOut.length ? cyclesOut[cyclesOut.length - 1].t : null;
  const producingRecently = lastCycleMs != null && nowMs - lastCycleMs < 15 * 60 * 1000;

  let currentState: MachinePulseState;
  if (offline) currentState = "offline";
  else if (moldOngoing) currentState = "mold-change";
  else if (macroActive || hbStatus === "STOP" || hbStatus === "DOWN") currentState = "stopped";
  else if (microActive) currentState = "microstop";
  else if (hbStatus === "IDLE") currentState = "idle";
  else if (hbStatus === "RUN" || hbStatus === "ONLINE" || producingRecently) currentState = "running";
  else currentState = "idle";

  return NextResponse.json({
    ok: true,
    machine,
    currentState,
    events: deduped,
    eventsCountAll,
    cycles: cyclesOut,
    thresholds,
    activeStoppage: null,
  });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ machineId: string }> }) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { machineId } = await params;
  if (!machineIdSchema.safeParse(machineId).success) {
    return NextResponse.json({ ok: false, error: "Invalid machine id" }, { status: 400 });
  }

  const membership = await prisma.orgUser.findUnique({
    where: {
      orgId_userId: {
        orgId: session.orgId,
        userId: session.userId,
      },
    },
    select: { role: true },
  });

  if (!canManageMachines(membership?.role)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      if (attempt === 0) {
        // Revoke credentials first in a committed write so ingest auth fails immediately.
        const revoked = await prisma.machine.updateMany({
          where: {
            id: machineId,
            orgId: session.orgId,
          },
          data: {
            apiKey: null,
          },
        });

        if (revoked.count === 0) {
          return NextResponse.json({ ok: false, error: "Machine not found" }, { status: 404 });
        }

        invalidateMachineAuth(machineId);
      }

      // Avoid long interactive transactions on very large history tables (P2028 timeout).
      // This sequence is idempotent and safe to retry because apiKey is revoked first.
      await prisma.machineCycle.deleteMany({
        where: {
          machineId,
        },
      });

      await prisma.machineHeartbeat.deleteMany({
        where: {
          machineId,
        },
      });

      await prisma.machineKpiSnapshot.deleteMany({
        where: {
          machineId,
        },
      });

      await prisma.machineEvent.deleteMany({
        where: {
          machineId,
        },
      });

      await prisma.machineWorkOrder.deleteMany({
        where: {
          machineId,
        },
      });

      await prisma.machineSettings.deleteMany({
        where: {
          machineId,
        },
      });

      await prisma.settingsAudit.deleteMany({
        where: {
          machineId,
        },
      });

      await prisma.alertNotification.deleteMany({
        where: {
          machineId,
        },
      });

      await prisma.machineFinancialOverride.deleteMany({
        where: {
          machineId,
        },
      });

      await prisma.reasonEntry.deleteMany({
        where: {
          machineId,
        },
      });

      await prisma.downtimeAction.updateMany({
        where: {
          machineId,
        },
        data: {
          machineId: null,
        },
      });

      const result = await prisma.machine.deleteMany({
        where: {
          id: machineId,
          orgId: session.orgId,
        },
      });

      if (result.count === 0) {
        return NextResponse.json({ ok: false, error: "Machine not found" }, { status: 404 });
      }

      invalidateMachineAuth(machineId);
      return NextResponse.json({ ok: true });
    } catch (err: unknown) {
      const code = err instanceof Prisma.PrismaClientKnownRequestError ? err.code : undefined;
      const message = err instanceof Error ? err.message : String(err);
      console.error("DELETE /api/machines/[machineId] failed", {
        machineId,
        orgId: session.orgId,
        attempt,
        code,
        message,
      });

      if (code === "P2003") {
        if (attempt < 2) {
          try {
            await cleanupMachineReferences(machineId);
          } catch (cleanupErr: unknown) {
            const cleanupMessage = cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr);
            console.error("DELETE /api/machines/[machineId] cleanup failed", {
              machineId,
              orgId: session.orgId,
              attempt,
              cleanupMessage,
            });
          }
          await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 150));
          continue;
        }

        return NextResponse.json(
          {
            ok: false,
            error: "Machine has dependent records and could not be removed",
            code,
          },
          { status: 409 }
        );
      }

      if (code === "P2022") {
        return NextResponse.json(
          {
            ok: false,
            error: "Server schema is out of date for machine delete",
            code,
          },
          { status: 500 }
        );
      }

      if (code === "P2028") {
        return NextResponse.json(
          {
            ok: false,
            error: "Delete timed out while removing machine history",
            code,
          },
          { status: 503 }
        );
      }

      if (code) {
        return NextResponse.json(
          {
            ok: false,
            error: "Delete failed due to database error",
            code,
          },
          { status: 500 }
        );
      }

      return NextResponse.json({ ok: false, error: "Delete failed" }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: false, error: "Delete failed", code: "DELETE_RETRY_EXHAUSTED" }, { status: 500 });
}
