import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/requireSession";
import { normalizeEvent } from "@/lib/events/normalizeEvent";

const machineIdSchema = z.string().uuid();

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
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
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
  const eventWhere = {
    orgId: session.orgId,
    machineId,
    ts: { gte: eventWindowStart },
    eventType: { in: Array.from(ALLOWED_EVENT_TYPES) },
    ...(eventsMode === "critical"
      ? {
          OR: [
            { eventType: "macrostop" },
            { requiresAck: true },
            { severity: { in: criticalSeverities } },
          ],
        }
      : {}),
  };

  const [rawEvents, eventsCountAll] = await Promise.all([
    prisma.machineEvent.findMany({
      where: eventWhere,
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
    prisma.machineEvent.count({ where: eventWhere }),
  ]);

  const normalized = rawEvents.map((row) =>
    normalizeEvent(row, { microMultiplier: stoppageMultiplier, macroMultiplier: macroStoppageMultiplier })
  );

  const seen = new Set<string>();
  const deduped = normalized.filter((event) => {
    const key = `${event.eventType}-${event.ts ?? ""}-${event.title}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  deduped.sort((a, b) => {
    const at = a.ts ? a.ts.getTime() : 0;
    const bt = b.ts ? b.ts.getTime() : 0;
    return bt - at;
  });

  return NextResponse.json({
    ok: true,
    machine,
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

  const result = await prisma.$transaction(async (tx) => {
    await tx.machineCycle.deleteMany({
      where: {
        machineId,
        orgId: session.orgId,
      },
    });

    return tx.machine.deleteMany({
      where: {
        id: machineId,
        orgId: session.orgId,
      },
    });
  });

  if (result.count === 0) {
    return NextResponse.json({ ok: false, error: "Machine not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}
