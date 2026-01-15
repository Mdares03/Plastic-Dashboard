import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getMachineAuth } from "@/lib/machineAuthCache";
import { z } from "zod";

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

const machineIdSchema = z.string().uuid();
const MAX_EVENTS = 100;

//when no cycle time is configed
const DEFAULT_MACROSTOP_SEC = 300;


function clampText(value: unknown, maxLen: number) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim().replace(/[\u0000-\u001f\u007f]/g, "");
  if (!text) return null;
  return text.length > maxLen ? text.slice(0, maxLen) : text;
}

export async function POST(req: Request) {
  const apiKey = req.headers.get("x-api-key");
  if (!apiKey) return NextResponse.json({ ok: false, error: "Missing api key" }, { status: 401 });

  let body: any = await req.json().catch(() => null);

  // ✅ if Node-RED sent an array as the whole body, unwrap it
  if (Array.isArray(body)) body = body[0];

  // ✅ accept multiple common keys
  const machineId = body?.machineId ?? body?.machine_id ?? body?.machine?.id;
  let rawEvent =
    body?.event ??
    body?.events ??
    body?.anomalies ??
    body?.payload?.event ??
    body?.payload?.events ??
    body?.payload?.anomalies ??
    body?.payload ??
    body?.data;           // sometimes "data"

    if (rawEvent?.event && typeof rawEvent.event === "object") rawEvent = rawEvent.event;
    if (Array.isArray(rawEvent?.events)) rawEvent = rawEvent.events;

  if (!machineId || !rawEvent) {
    return NextResponse.json(
      { ok: false, error: "Invalid payload", got: { hasMachineId: !!machineId, keys: Object.keys(body ?? {}) } },
      { status: 400 }
    );
  }

  if (!machineIdSchema.safeParse(String(machineId)).success) {
    return NextResponse.json({ ok: false, error: "Invalid machine id" }, { status: 400 });
  }

  const machine = await getMachineAuth(String(machineId), apiKey);
  if (!machine) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  const orgSettings = await prisma.orgSettings.findUnique({
    where: { orgId: machine.orgId },
    select: { stoppageMultiplier: true, macroStoppageMultiplier: true },
  });

  const defaultMicroMultiplier = Number(orgSettings?.stoppageMultiplier ?? 1.5);
  const defaultMacroMultiplier = Math.max(
    defaultMicroMultiplier,
    Number(orgSettings?.macroStoppageMultiplier ?? 5)
  );


  // ✅ normalize to array no matter what
  const events = Array.isArray(rawEvent) ? rawEvent : [rawEvent];
  if (events.length > MAX_EVENTS) {
    return NextResponse.json({ ok: false, error: "Too many events" }, { status: 400 });
  }

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
        const theoretical =
          Number(
            (ev as any)?.data?.theoretical_cycle_time ??
              (ev as any)?.data?.theoreticalCycleTime ??
              0
          ) || 0;

        const microMultiplier = Number(
          (ev as any)?.data?.micro_threshold_multiplier ??
            (ev as any)?.data?.threshold_multiplier ??
            defaultMicroMultiplier
        );
        const macroMultiplier = Math.max(
          microMultiplier,
          Number((ev as any)?.data?.macro_threshold_multiplier ?? defaultMacroMultiplier)
        );

        if (theoretical > 0) {
          const macroThresholdSec = theoretical * macroMultiplier;
          finalType = stopSec >= macroThresholdSec ? "macrostop" : "microstop";
        } else {
          finalType = stopSec >= DEFAULT_MACROSTOP_SEC ? "macrostop" : "microstop";
        }
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
      clampText((ev as any).title, 160) ||
      (finalType === "slow-cycle" ? "Slow Cycle Detected" :
       finalType === "macrostop" ? "Macrostop Detected" :
       finalType === "microstop" ? "Microstop Detected" :
       "Event");

    const description = clampText((ev as any).description, 1000);

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
        topic: clampText((ev as any).topic ?? finalType, 64) ?? finalType,
        eventType: finalType,
        severity: sev,
        requiresAck: !!(ev as any).requires_ack,
        title,
        description,
        data: dataObj,
        workOrderId:
          clampText((ev as any)?.work_order_id, 64) ??
          clampText((ev as any)?.data?.work_order_id, 64) ??
          null,
        sku:
          clampText((ev as any)?.sku, 64) ??
          clampText((ev as any)?.data?.sku, 64) ??
          null,
      },
    });

    created.push({ id: row.id, ts: row.ts, eventType: row.eventType });
  }

  return NextResponse.json({ ok: true, createdCount: created.length, created, skippedCount: skipped.length, skipped });
}
