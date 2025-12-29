import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeEventV1 } from "@/lib/contracts/v1";

function getClientIp(req: Request) {
  const xf = req.headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0]?.trim() || null;
  return req.headers.get("x-real-ip") || null;
}

function parseSeqToBigInt(seq: unknown): bigint | null {
  if (seq === null || seq === undefined) return null;
  if (typeof seq === "number") {
    if (!Number.isInteger(seq) || seq < 0) return null;
    return BigInt(seq);
  }
  if (typeof seq === "string" && /^\d+$/.test(seq)) return BigInt(seq);
  return null;
}

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
  const endpoint = "/api/ingest/event";
  const ip = getClientIp(req);
  const userAgent = req.headers.get("user-agent");

  let rawBody: any = null;
  let orgId: string | null = null;
  let machineId: string | null = null;
  let schemaVersion: string | null = null;
  let seq: bigint | null = null;
  let tsDeviceDate: Date | null = null;

  try {
    // 1) Auth header exists
    const apiKey = req.headers.get("x-api-key");
    if (!apiKey) {
      await prisma.ingestLog.create({
        data: {
          endpoint,
          ok: false,
          status: 401,
          errorCode: "MISSING_API_KEY",
          errorMsg: "Missing api key",
          ip,
          userAgent,
        },
      });
      return NextResponse.json({ ok: false, error: "Missing api key" }, { status: 401 });
    }

    // 2) Parse JSON
    rawBody = await req.json().catch(() => null);

    // 3) Reject arrays at the contract boundary (Phase 0 rule)
    // Edge MUST split arrays into one event per POST.
    if (rawBody?.event && Array.isArray(rawBody.event)) {
      await prisma.ingestLog.create({
        data: {
          endpoint,
          ok: false,
          status: 400,
          errorCode: "EVENT_ARRAY_NOT_ALLOWED",
          errorMsg: "Edge must split arrays; send one event per request.",
          body: rawBody,
          machineId: rawBody?.machineId ? String(rawBody.machineId) : null,
          ip,
          userAgent,
        },
      });
      return NextResponse.json(
        { ok: false, error: "Invalid payload", detail: "event array not allowed; split on edge" },
        { status: 400 }
      );
    }

    // 4) Normalize to v1 (legacy tolerated)
    const normalized = normalizeEventV1(rawBody);
    if (!normalized.ok) {
      await prisma.ingestLog.create({
        data: {
          endpoint,
          ok: false,
          status: 400,
          errorCode: "INVALID_PAYLOAD",
          errorMsg: normalized.error,
          body: rawBody,
          ip,
          userAgent,
        },
      });
      return NextResponse.json({ ok: false, error: "Invalid payload", detail: normalized.error }, { status: 400 });
    }

    const body = normalized.value;

    schemaVersion = body.schemaVersion;
    machineId = body.machineId;
    seq = parseSeqToBigInt(body.seq);
    tsDeviceDate = new Date(body.tsDevice);

    // 5) Authorize machineId + apiKey
    const machine = await prisma.machine.findFirst({
      where: { id: machineId, apiKey },
      select: { id: true, orgId: true },
    });

    if (!machine) {
      await prisma.ingestLog.create({
        data: {
          endpoint,
          ok: false,
          status: 401,
          errorCode: "UNAUTHORIZED",
          errorMsg: "Unauthorized (machineId/apiKey mismatch)",
          body: rawBody,
          machineId,
          schemaVersion,
          seq,
          tsDevice: tsDeviceDate,
          ip,
          userAgent,
        },
      });
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    orgId = machine.orgId;

    // 6) Canonicalize + classify type (keep for now; later move to edge in A1)
    const ev = body.event;

    const rawType =
      (ev as any).eventType ?? (ev as any).anomaly_type ?? (ev as any).topic ?? (body as any).topic ?? "";
    const typ0 = normalizeType(rawType);
    const typ = CANON_TYPE[typ0] ?? typ0;

    let finalType = typ;

    // Stop classification -> microstop/macrostop
    if (typ === "stop") {
      const stopSec =
        (typeof (ev as any)?.data?.stoppage_duration_seconds === "number" && (ev as any).data.stoppage_duration_seconds) ||
        (typeof (ev as any)?.data?.stop_duration_seconds === "number" && (ev as any).data.stop_duration_seconds) ||
        null;

      if (stopSec != null) {
        finalType = stopSec >= MACROSTOP_SEC ? "macrostop" : "microstop";
      } else {
        finalType = "microstop";
      }
    }

    if (!ALLOWED_TYPES.has(finalType)) {
      await prisma.ingestLog.create({
        data: {
          orgId,
          machineId: machine.id,
          endpoint,
          ok: false,
          status: 400,
          errorCode: "TYPE_NOT_ALLOWED",
          errorMsg: `Event type not allowed: ${finalType}`,
          schemaVersion,
          seq,
          tsDevice: tsDeviceDate,
          body: rawBody,
          ip,
          userAgent,
        },
      });
      return NextResponse.json(
        { ok: false, error: "Invalid event type", detail: finalType },
        { status: 400 }
      );
    }

    // Determine severity
    let sev = String((ev as any).severity ?? "").trim().toLowerCase();
    if (!sev) sev = "warning";

    const title =
      String((ev as any).title ?? "").trim() ||
      (finalType === "slow-cycle"
        ? "Slow Cycle Detected"
        : finalType === "macrostop"
        ? "Macrostop Detected"
        : finalType === "microstop"
        ? "Microstop Detected"
        : "Event");

    const description = (ev as any).description ? String((ev as any).description) : null;

    // store full blob
    const rawData = (ev as any).data ?? ev;
    const dataObj =
      typeof rawData === "string"
        ? (() => {
            try {
              return JSON.parse(rawData);
            } catch {
              return { raw: rawData };
            }
          })()
        : rawData;

    // Prefer work_order_id always
    const workOrderId =
      (ev as any)?.work_order_id ? String((ev as any).work_order_id)
      : (ev as any)?.data?.work_order_id ? String((ev as any).data.work_order_id)
      : null;

    const sku =
      (ev as any)?.sku ? String((ev as any).sku)
      : (ev as any)?.data?.sku ? String((ev as any).data.sku)
      : null;

    // 7) Store event with Phase 0 meta
    const row = await prisma.machineEvent.create({
      data: {
        orgId,
        machineId: machine.id,

        // Phase 0 meta
        schemaVersion,
        seq,
        ts: tsDeviceDate,

        topic: String((ev as any).topic ?? finalType),
        eventType: finalType,
        severity: sev,
        requiresAck: !!(ev as any).requires_ack,
        title,
        description,
        data: dataObj,
        workOrderId,
        sku,
      },
    });

    // Optional: update machine last seen
    await prisma.machine.update({
      where: { id: machine.id },
      data: {
        schemaVersion,
        seq,
        tsDevice: tsDeviceDate,
        tsServer: new Date(),
      },
    });

    // 8) Ingest log success
    await prisma.ingestLog.create({
      data: {
        orgId,
        machineId: machine.id,
        endpoint,
        ok: true,
        status: 200,
        schemaVersion,
        seq,
        tsDevice: tsDeviceDate,
        body: rawBody,
        ip,
        userAgent,
      },
    });

    return NextResponse.json({
      ok: true,
      createdCount: 1,
      created: [{ id: row.id, ts: row.ts, eventType: row.eventType }],
      skippedCount: 0,
      skipped: [],
    });
  } catch (err: any) {
    const msg = err?.message ? String(err.message) : "Unknown error";

    try {
      await prisma.ingestLog.create({
        data: {
          orgId,
          machineId,
          endpoint,
          ok: false,
          status: 500,
          errorCode: "SERVER_ERROR",
          errorMsg: msg,
          schemaVersion,
          seq,
          tsDevice: tsDeviceDate ?? undefined,
          body: rawBody,
          ip,
          userAgent,
        },
      });
    } catch {}

    return NextResponse.json({ ok: false, error: "Server error", detail: msg }, { status: 500 });
  }
}
