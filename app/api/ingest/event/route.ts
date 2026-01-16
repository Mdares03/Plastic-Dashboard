import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getMachineAuth } from "@/lib/machineAuthCache";
import { z } from "zod";
import { evaluateAlertsForEvent } from "@/lib/alerts/engine";
import { toJsonValue } from "@/lib/prismaJson";

const normalizeType = (t: unknown) =>
  String(t ?? "")
    .trim()
    .toLowerCase()
    .replace(/_/g, "-");

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

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
  "offline",
  "error",
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

  let body: unknown = await req.json().catch(() => null);

  // ✅ if Node-RED sent an array as the whole body, unwrap it
  if (Array.isArray(body)) body = body[0];
  const bodyRecord = asRecord(body) ?? {};
  const payloadRecord = asRecord(bodyRecord.payload) ?? {};

  // ✅ accept multiple common keys
  const machineId =
    bodyRecord.machineId ??
    bodyRecord.machine_id ??
    (asRecord(bodyRecord.machine)?.id ?? null);
  let rawEvent =
    bodyRecord.event ??
    bodyRecord.events ??
    bodyRecord.anomalies ??
    payloadRecord.event ??
    payloadRecord.events ??
    payloadRecord.anomalies ??
    payloadRecord ??
    bodyRecord.data; // sometimes "data"

  const rawEventRecord = asRecord(rawEvent);
  if (rawEventRecord?.event && typeof rawEventRecord.event === "object") rawEvent = rawEventRecord.event;
  if (Array.isArray(rawEventRecord?.events)) rawEvent = rawEventRecord.events;

  if (!machineId || !rawEvent) {
    return NextResponse.json(
      { ok: false, error: "Invalid payload", got: { hasMachineId: !!machineId, keys: Object.keys(bodyRecord) } },
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
  const skipped: Array<Record<string, unknown>> = [];

  for (const ev of events) {
    const evRecord = asRecord(ev);
    if (!evRecord) {
      skipped.push({ reason: "invalid_event_object" });
      continue;
    }
    const evData = asRecord(evRecord.data) ?? {};

    const rawType = evRecord.eventType ?? evRecord.anomaly_type ?? evRecord.topic ?? bodyRecord.topic ?? "";
    const typ0 = normalizeType(rawType);
    const typ = CANON_TYPE[typ0] ?? typ0;

    // Determine timestamp
    const tsMs =
      (typeof evRecord.timestamp === "number" && evRecord.timestamp) ||
      (typeof evData.timestamp === "number" && evData.timestamp) ||
      (typeof evData.event_timestamp === "number" && evData.event_timestamp) ||
      null;

    const ts = tsMs ? new Date(tsMs) : new Date();

    // Severity defaulting (do not skip on severity — store for audit)
    let sev = String(evRecord.severity ?? "").trim().toLowerCase();
    if (!sev) sev = "warning";

    // Stop classification -> microstop/macrostop
    let finalType = typ;
    if (typ === "stop") {
      const stopSec =
        (typeof evData.stoppage_duration_seconds === "number" && evData.stoppage_duration_seconds) ||
        (typeof evData.stop_duration_seconds === "number" && evData.stop_duration_seconds) ||
        null;

      if (stopSec != null) {
        const theoretical = Number(evData.theoretical_cycle_time ?? evData.theoreticalCycleTime ?? 0) || 0;

        const microMultiplier = Number(
          evData.micro_threshold_multiplier ?? evData.threshold_multiplier ?? defaultMicroMultiplier
        );
        const macroMultiplier = Math.max(
          microMultiplier,
          Number(evData.macro_threshold_multiplier ?? defaultMacroMultiplier)
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
      clampText(evRecord.title, 160) ||
      (finalType === "slow-cycle" ? "Slow Cycle Detected" :
       finalType === "macrostop" ? "Macrostop Detected" :
       finalType === "microstop" ? "Microstop Detected" :
       "Event");

    const description = clampText(evRecord.description, 1000);

    // store full blob, ensure object
    const rawData = evRecord.data ?? evRecord;
    const parsedData = typeof rawData === "string"
      ? (() => {
          try {
            return JSON.parse(rawData);
          } catch {
            return { raw: rawData };
          }
        })()
      : rawData;
    const dataObj: Record<string, unknown> =
      parsedData && typeof parsedData === "object" && !Array.isArray(parsedData)
        ? { ...(parsedData as Record<string, unknown>) }
        : { raw: parsedData };
    if (evRecord.status != null && dataObj.status == null) dataObj.status = evRecord.status;
    if (evRecord.alert_id != null && dataObj.alert_id == null) dataObj.alert_id = evRecord.alert_id;
    if (evRecord.is_update != null && dataObj.is_update == null) dataObj.is_update = evRecord.is_update;
    if (evRecord.is_auto_ack != null && dataObj.is_auto_ack == null) dataObj.is_auto_ack = evRecord.is_auto_ack;

    const activeWorkOrder = asRecord(evRecord.activeWorkOrder);
    const dataActiveWorkOrder = asRecord(evData.activeWorkOrder);

    const row = await prisma.machineEvent.create({
      data: {
        orgId: machine.orgId,
        machineId: machine.id,
        ts,
        topic: clampText(evRecord.topic ?? finalType, 64) ?? finalType,
        eventType: finalType,
        severity: sev,
        requiresAck: !!evRecord.requires_ack,
        title,
        description,
        data: toJsonValue(dataObj),
        workOrderId:
          clampText(evRecord.work_order_id, 64) ??
          clampText(evData.work_order_id, 64) ??
          clampText(activeWorkOrder?.id, 64) ??
          clampText(dataActiveWorkOrder?.id, 64) ??
          null,
        sku:
          clampText(evRecord.sku, 64) ??
          clampText(evData.sku, 64) ??
          clampText(activeWorkOrder?.sku, 64) ??
          clampText(dataActiveWorkOrder?.sku, 64) ??
          null,
      },
    });

    created.push({ id: row.id, ts: row.ts, eventType: row.eventType });

    try {
      await evaluateAlertsForEvent(row.id);
    } catch (err) {
      console.error("[alerts] evaluation failed", err);
    }
  }

  return NextResponse.json({ ok: true, createdCount: created.length, created, skippedCount: skipped.length, skipped });
}
