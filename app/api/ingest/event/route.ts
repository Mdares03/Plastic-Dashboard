import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export async function POST(req: Request) {
  const apiKey = req.headers.get("x-api-key");
  if (!apiKey) return NextResponse.json({ ok: false, error: "Missing api key" }, { status: 401 });

  const body = await req.json().catch(() => null);
  if (!body?.machineId || !body?.event) {
    return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
  }

  const machine = await prisma.machine.findFirst({
    where: { id: String(body.machineId), apiKey },
    select: { id: true, orgId: true },
  });
  if (!machine) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  

  // Convert ms epoch -> Date if provided

  
  
const e = body.event;

const ts =
  typeof e?.data?.timestamp === "number"
    ? new Date(e.data.timestamp)
    : undefined;

// normalize inputs from event
const sev = String(e.severity ?? "").toLowerCase();
const typ = String(e.eventType ?? e.anomaly_type ?? "").toLowerCase();
const title = String(e.title ?? "").trim();

const ALLOWED_TYPES = new Set([
  "slow-cycle",
  "anomaly-detected",
  "performance-degradation",
  "scrap-spike",
  "down",
  "microstop",
]);

const ALLOWED_SEVERITIES = new Set(["warning", "critical"]);

// Drop generic/noise
if (!ALLOWED_SEVERITIES.has(sev) || !ALLOWED_TYPES.has(typ)) {
  return NextResponse.json({ ok: true, skipped: true }, { status: 200 });
}

if (!title) return NextResponse.json({ ok: true, skipped: true }, { status: 200 });



  const row = await prisma.machineEvent.create({
    data: {
      orgId: machine.orgId,
      machineId: machine.id,
      ts: ts ?? undefined,

      topic: e.topic ? String(e.topic) : "event",
      eventType: e.anomaly_type ? String(e.anomaly_type) : "unknown",
      severity: e.severity ? String(e.severity) : "info",
      requiresAck: !!e.requires_ack,
      title: e.title ? String(e.title) : "Event",
      description: e.description ? String(e.description) : null,

      data: e.data ?? e, // store full blob

      workOrderId: e?.data?.work_order_id ? String(e.data.work_order_id) : null,
    },
  });

  return NextResponse.json({ ok: true, id: row.id, ts: row.ts });
}
