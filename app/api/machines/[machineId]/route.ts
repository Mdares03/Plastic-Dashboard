import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/requireSession";

function normalizeEvent(row: any) {
  // -----------------------------
  // 1) Parse row.data safely
  // data may be:
  //   - object
  //   - array of objects
  //   - JSON string of either
  // -----------------------------
  const raw = row.data;

  let parsed: any = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = raw; // keep as string if not JSON
    }
  }

  // data can be object OR [object]
  const blob = Array.isArray(parsed) ? parsed[0] : parsed;

  // some payloads nest details under blob.data
  const inner = blob?.data ?? blob ?? {};

  const normalizeType = (t: any) =>
    String(t ?? "")
      .trim()
      .toLowerCase()
      .replace(/_/g, "-");

  // -----------------------------
  // 2) Alias mapping (canonical types)
  // -----------------------------
  const ALIAS: Record<string, string> = {
    // Spanish / synonyms
    macroparo: "macrostop",
    "macro-stop": "macrostop",
    macro_stop: "macrostop",

    microparo: "microstop",
    "micro-paro": "microstop",
    micro_stop: "microstop",

    // Node-RED types
    "production-stopped": "stop", // we'll classify to micro/macro below

    // legacy / generic
    down: "stop",
  };

  // -----------------------------
  // 3) Determine event type from DB or blob
  // -----------------------------
  const fromDbType =
    row.eventType && row.eventType !== "unknown" ? row.eventType : null;

  const fromBlobType =
    blob?.anomaly_type ??
    blob?.eventType ??
    blob?.topic ??
    inner?.anomaly_type ??
    inner?.eventType ??
    null;

  // infer slow-cycle if signature exists
  const inferredType =
    fromDbType ??
    fromBlobType ??
    ((inner?.actual_cycle_time && inner?.theoretical_cycle_time) ||
    (blob?.actual_cycle_time && blob?.theoretical_cycle_time)
      ? "slow-cycle"
      : "unknown");

  const eventTypeRaw = normalizeType(inferredType);
  let eventType = ALIAS[eventTypeRaw] ?? eventTypeRaw;

  // -----------------------------
  // 4) Optional: classify "stop" into micro/macro based on duration if present
  // (keeps old rows usable even if they stored production-stopped)
  // -----------------------------
  if (eventType === "stop") {
    const stopSec =
      (typeof inner?.stoppage_duration_seconds === "number" && inner.stoppage_duration_seconds) ||
      (typeof blob?.stoppage_duration_seconds === "number" && blob.stoppage_duration_seconds) ||
      (typeof inner?.stop_duration_seconds === "number" && inner.stop_duration_seconds) ||
      null;

    // tune these thresholds to match your MES spec
    const MACROSTOP_SEC = 300; // 5 min
    eventType = stopSec != null && stopSec >= MACROSTOP_SEC ? "macrostop" : "microstop";
  }

  // -----------------------------
  // 5) Severity, title, description, timestamp
  // -----------------------------
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
    (inner?.actual_cycle_time ?? blob?.actual_cycle_time) &&
    (inner?.theoretical_cycle_time ?? blob?.theoretical_cycle_time) &&
    (inner?.delta_percent ?? blob?.delta_percent) != null
      ? `Cycle took ${Number(inner?.actual_cycle_time ?? blob?.actual_cycle_time).toFixed(1)}s (+${Number(inner?.delta_percent ?? blob?.delta_percent)}% vs ${Number(inner?.theoretical_cycle_time ?? blob?.theoretical_cycle_time).toFixed(1)}s objetivo)`
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
  "microstop",
  "macrostop",
  "oee-drop",
  "quality-spike",
  "performance-degradation",
  "predictive-oee-decline",
]);

const events = normalized
  .filter((e) => ALLOWED_TYPES.has(e.eventType))
  // drop severity gating so recent info events appear
  .slice(0, 30);


// ---- cycles window ----
const url = new URL(_req.url);
const windowSec = Number(url.searchParams.get("windowSec") ?? "10800"); // default 3h

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
const takeCycles = Math.min(5000, Math.max(200, needed));

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



