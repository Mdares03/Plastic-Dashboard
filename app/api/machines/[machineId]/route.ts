import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/requireSession";

function normalizeEvent(row: any) {
  // data can be object OR [object]
  const raw = row.data;
  const blob = Array.isArray(raw) ? raw[0] : raw;

  // some payloads nest details under blob.data
  const inner = blob?.data ?? blob ?? {};

  const normalizeType = (t: any) =>
    String(t ?? "")
      .trim()
      .toLowerCase()
      .replace(/_/g, "-");

  // Prefer the DB columns if they are meaningful
  const fromDbType = row.eventType && row.eventType !== "unknown" ? row.eventType : null;
  const fromBlobType = blob?.anomaly_type ?? blob?.eventType ?? blob?.topic ?? inner?.anomaly_type ?? inner?.eventType ?? null;

  // infer slow-cycle if the signature exists
  const inferredType =
    fromDbType ??
    fromBlobType ??
    ((inner?.actual_cycle_time && inner?.theoretical_cycle_time) || (blob?.actual_cycle_time && blob?.theoretical_cycle_time)
      ? "slow-cycle"
      : "unknown");


  const eventType = normalizeType(inferredType);

  const severity =
    String(
      (row.severity && row.severity !== "info" ? row.severity : null) ??
        blob?.severity ??
        inner?.severity ??
        "info"
    )
      .trim()
      .toLowerCase();

  const title =
    String(
      (row.title && row.title !== "Event" ? row.title : null) ??
        blob?.title ??
        inner?.title ??
        (eventType === "slow-cycle" ? "Slow Cycle Detected" : "Event")
    ).trim();

  const description =
    row.description ??
    blob?.description ??
    inner?.description ??
    (eventType === "slow-cycle" &&
    inner?.actual_cycle_time &&
    inner?.theoretical_cycle_time &&
    inner?.delta_percent != null
      ? `Cycle took ${Number(inner.actual_cycle_time).toFixed(1)}s (+${inner.delta_percent}% vs ${Number(inner.theoretical_cycle_time).toFixed(1)}s objetivo)`
      : null);

  const ts =
    row.ts ??
    (typeof blob?.timestamp === "number" ? new Date(blob.timestamp) : null) ??
    (typeof inner?.timestamp === "number" ? new Date(inner.timestamp) : null) ??
    null;

  const workOrderId =
    row.workOrderId ??
    blob?.work_order_id ??
    inner?.work_order_id ??
    null;

  return {
    id: row.id,
    ts,
    topic: String(row.topic ?? blob?.topic ?? eventType),
    eventType,
    severity,
    title,
    description,
    requiresAck: !!row.requiresAck,
    workOrderId,
  };
}




export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ machineId: string }> }
) {
  const session = await requireSession();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const { machineId } = await params;

  const machine = await prisma.machine.findFirst({
    where: { id: machineId, orgId: session.orgId },
    select: {
      id: true,
      name: true,
      code: true,
      location: true,
      heartbeats: {
        orderBy: { ts: "desc" },
        take: 1,
        select: { ts: true, status: true, message: true, ip: true, fwVersion: true },
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

  const rawEvents = await prisma.machineEvent.findMany({
    where: {
      orgId: session.orgId,
      machineId,
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

  const normalized = rawEvents.map(normalizeEvent);

const ALLOWED_TYPES = new Set([
  "slow-cycle",
  "anomaly-detected",
  "performance-degradation",
  "scrap-spike",
  "down",
  "microstop",
]);

const events = normalized
  .filter((e) => ALLOWED_TYPES.has(e.eventType))
  // keep slow-cycle even if severity is info, otherwise require warning/critical/error
  .filter((e) => e.eventType === "slow-cycle" || ["warning", "critical", "error"].includes(e.severity))
  .slice(0, 30);


const rawCycles = await prisma.machineCycle.findMany({
  where: { orgId: session.orgId, machineId },
  orderBy: { ts: "desc" },
  take: 200,
  select: {
    ts: true,
    cycleCount: true,
    actualCycleTime: true,
    theoreticalCycleTime: true,
    workOrderId: true,
    sku: true,
  },
});

// chart-friendly: oldest -> newest + numeric timestamps
const cycles = rawCycles
  .slice()
  .reverse()
  .map((c) => ({
    ts: c.ts,                       // keep Date for “time ago” UI
    t: c.ts.getTime(),              // numeric x-axis for charts
    cycleCount: c.cycleCount ?? null,
    actual: c.actualCycleTime,      // rename to what chart expects
    ideal: c.theoreticalCycleTime ?? null,
    workOrderId: c.workOrderId ?? null,
    sku: c.sku ?? null,
  }
));

const latestKpi = machine.kpiSnapshots[0] ?? null;

// rawCycles is ordered DESC, so [0] is the most recent cycle row
const latestCycleIdeal = rawCycles[0]?.theoreticalCycleTime ?? null;

// REAL effective value (not mock): prefer KPI if present, else fallback to cycles table
const effectiveCycleTime = latestKpi?.cycleTime ?? latestCycleIdeal ?? null;




  return NextResponse.json({
    ok: true,
    machine: {
      id: machine.id,
      name: machine.name,
      code: machine.code,
      location: machine.location,
      latestHeartbeat: machine.heartbeats[0] ?? null,
      latestKpi: machine.kpiSnapshots[0] ?? null,
      effectiveCycleTime
      
    },
    events,
    cycles
  });
  
}



