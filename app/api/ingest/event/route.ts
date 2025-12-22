import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const normalizeType = (t: any) =>
  String(t ?? "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-");

const CANON_TYPE: Record<string, string> = {
  // Node-RED
  "production-stopped": "stop",
  "oee-drop": "oee-drop",
  "quality-spike": "quality-spike",
  "predictive-oee-decline": "predictive-oee-decline",
  "performance-degradation": "performance-degradation",

  // legacy / synonyms
  "macroparo": "macrostop",
  "macro-stop": "macrostop",
  "microparo": "microstop",
  "micro-paro": "microstop",
  "down": "stop",
};

const ALLOWED_TYPES = new Set([
  "slow-cycle",
  "microstop",
  "macrostop",
  "oee-drop",
  "quality-spike",
  "performance-degradation",
  "predictive-oee-decline",
]);

// thresholds for stop classification (tune later / move to machine config)
const MICROSTOP_SEC = 60;
const MACROSTOP_SEC = 300;

export async function POST(req: Request) {
  const apiKey = req.headers.get("x-api-key");
  if (!apiKey) {
    return NextResponse.json({ ok: false, error: "Missing api key" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  if (!body?.machineId || !body?.event) {
    return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
  }
  

  const machine = await prisma.machine.findFirst({
    where: { id: String(body.machineId), apiKey },
    select: { id: true, orgId: true },
  });
  if (!machine) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  // Normalize to array (Node-RED sends array of anomalies)
  const rawEvent = body.event;
  const events = Array.isArray(rawEvent) ? rawEvent : [rawEvent];

  const created: { id: string; ts: Date; eventType: string }[] = [];
  const skipped: any[] = [];

  for (const ev of events) {
    if (!ev || typeof ev !== "object") {
      skipped.push({ reason: "invalid_event_object" });
      continue;
    }

    const rawType = (ev as any).eventType ?? (ev as any).anomaly_type ?? (ev as any).topic ?? body.topic ?? "";
    const typ0 = normalizeType(rawType);
    const typ = CANON_TYPE[typ0] ?? typ0;

    // Determine timestamp
    const tsMs =
      (typeof (ev as any)?.timestamp === "number" && (ev as any).timestamp) ||
      (typeof (ev as any)?.data?.timestamp === "number" && (ev as any).data.timestamp) ||
      (typeof (ev as any)?.data?.event_timestamp === "number" && (ev as any).data.event_timestamp) ||
      null;

    const ts = tsMs ? new Date(tsMs) : new Date();

    // Severity defaulting (do not skip on severity — store for audit)
    let sev = String((ev as any).severity ?? "").trim().toLowerCase();
    if (!sev) sev = "warning";

    // Stop classification -> microstop/macrostop
    let finalType = typ;
    if (typ === "stop") {
      const stopSec =
        (typeof (ev as any)?.data?.stoppage_duration_seconds === "number" && (ev as any).data.stoppage_duration_seconds) ||
        (typeof (ev as any)?.data?.stop_duration_seconds === "number" && (ev as any).data.stop_duration_seconds) ||
        null;

      if (stopSec != null) {
        finalType = stopSec >= MACROSTOP_SEC ? "macrostop" : "microstop";
      } else {
        // missing duration -> conservative
        finalType = "microstop";
      }
    }

    if (!ALLOWED_TYPES.has(finalType)) {
      skipped.push({ reason: "type_not_allowed", typ: finalType, sev });
      continue;
    }

    const title =
      String((ev as any).title ?? "").trim() ||
      (finalType === "slow-cycle" ? "Slow Cycle Detected" :
       finalType === "macrostop" ? "Macrostop Detected" :
       finalType === "microstop" ? "Microstop Detected" :
       "Event");

    const description = (ev as any).description ? String((ev as any).description) : null;

    // store full blob, ensure object
    const rawData = (ev as any).data ?? ev;
    const dataObj = typeof rawData === "string" ? (() => {
      try { return JSON.parse(rawData); } catch { return { raw: rawData }; }
    })() : rawData;

    const row = await prisma.machineEvent.create({
      data: {
        orgId: machine.orgId,
        machineId: machine.id,
        ts,
        topic: String((ev as any).topic ?? finalType),
        eventType: finalType,
        severity: sev,
        requiresAck: !!(ev as any).requires_ack,
        title,
        description,
        data: dataObj,
        workOrderId:
          (ev as any)?.work_order_id ? String((ev as any).work_order_id)
          : (ev as any)?.data?.work_order_id ? String((ev as any).data.work_order_id)
          : null,
        sku:
          (ev as any)?.sku ? String((ev as any).sku)
          : (ev as any)?.data?.sku ? String((ev as any).data.sku)
          : null,
      },
    });

    created.push({ id: row.id, ts: row.ts, eventType: row.eventType });
  }

  return NextResponse.json({ ok: true, createdCount: created.length, created, skippedCount: skipped.length, skipped });
}
