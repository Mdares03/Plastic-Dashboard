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

  
  
const rawEvent = body.event;
const e = Array.isArray(rawEvent) ? rawEvent[0] : rawEvent;

if (!e || typeof e !== "object") {
  return NextResponse.json({ ok: false, error: "Invalid event object" }, { status: 400 });
}
const rawType =
  e.eventType ?? e.anomaly_type ?? e.topic ?? body.topic ?? "";

const normalizeType = (t: string) =>
  String(t)
    .trim()
    .toLowerCase()
    .replace(/_/g, "-");

const typ = normalizeType(rawType);
const sev = String(e.severity ?? "").trim().toLowerCase();

// accept these types
const ALLOWED_TYPES = new Set([
  "slow-cycle",
  "anomaly-detected",
  "performance-degradation",
  "scrap-spike",
  "down",
  "microstop",
]);

if (!ALLOWED_TYPES.has(typ)) {
  return NextResponse.json({ ok: true, skipped: true, reason: "type_not_allowed", typ, sev }, { status: 200 });
}

// optional: severity enforcement only for SOME types (not slow-cycle)
const NEEDS_HIGH_SEV = new Set(["down", "scrap-spike"]);
const ALLOWED_SEVERITIES = new Set(["warning", "critical", "error"]);

if (NEEDS_HIGH_SEV.has(typ) && !ALLOWED_SEVERITIES.has(sev)) {
  return NextResponse.json({ ok: true, skipped: true, reason: "severity_too_low", typ, sev }, { status: 200 });
}

// timestamp handling (support multiple field names)
const tsMs =
  (typeof (e as any)?.timestamp === "number" && (e as any).timestamp) ||
  (typeof e?.data?.timestamp === "number" && e.data.timestamp) ||
  (typeof e?.data?.event_timestamp === "number" && e.data.event_timestamp) ||
  (typeof e?.data?.ts === "number" && e.data.ts) ||
  undefined;

const ts = tsMs ? new Date(tsMs) : new Date(); // default to now if missing

const title =
  String(e.title ?? "").trim() ||
  (typ === "slow-cycle" ? "Slow Cycle Detected" : "Event");

const description = e.description
  ? String(e.description)
  : null;

const row = await prisma.machineEvent.create({
  data: {
    orgId: machine.orgId,
    machineId: machine.id,
    ts,

    topic: String(e.topic ?? typ),
    eventType: typ,                 // ✅ store normalized type
    severity: sev || "info",        // ✅ store normalized severity
    requiresAck: !!e.requires_ack,
    title,
    description,

    data: e.data ?? e,

  workOrderId:
    (e as any)?.work_order_id ? String((e as any).work_order_id)
    : e?.data?.work_order_id ? String(e.data.work_order_id)
    : null,
  },
});

return NextResponse.json({ ok: true, id: row.id, ts: row.ts });

}
