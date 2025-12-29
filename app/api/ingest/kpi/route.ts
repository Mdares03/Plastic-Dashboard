// mis-control-tower/app/api/ingest/kpi/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeSnapshotV1 } from "@/lib/contracts/v1";

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

export async function POST(req: Request) {
  const endpoint = "/api/ingest/kpi";
  const startedAt = Date.now();
  const ip = getClientIp(req);
  const userAgent = req.headers.get("user-agent");

  let rawBody: any = null;
  let orgId: string | null = null;
  let machineId: string | null = null;
  let seq: bigint | null = null;
  let schemaVersion: string | null = null;
  let tsDeviceDate: Date | null = null;

  try {
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

    rawBody = await req.json().catch(() => null);
    const normalized = normalizeSnapshotV1(rawBody);
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

    // Auth: machineId + apiKey must match
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

    const wo = body.activeWorkOrder ?? {};
    const k = body.kpis ?? {};
    const safeCycleTime =
    typeof body.cycleTime === "number" && body.cycleTime > 0
      ? body.cycleTime
      : (typeof (wo as any).cycleTime === "number" && (wo as any).cycleTime > 0 ? (wo as any).cycleTime : null);

  const safeCavities =
    typeof body.cavities === "number" && body.cavities > 0
      ? body.cavities
      : (typeof (wo as any).cavities === "number" && (wo as any).cavities > 0 ? (wo as any).cavities : null);
    // Write snapshot (ts = tsDevice; tsServer auto)
    const row = await prisma.machineKpiSnapshot.create({
      data: {
        orgId,
        machineId: machine.id,

        // Phase 0 meta
        schemaVersion,
        seq,
        ts: tsDeviceDate, // store device-time in ts; server-time goes to ts_server

        // Work order fields
        workOrderId: wo.id ? String(wo.id) : null,
        sku: wo.sku ? String(wo.sku) : null,
        target: typeof wo.target === "number" ? Math.trunc(wo.target) : null,
        good: typeof wo.good === "number" ? Math.trunc(wo.good) : null,
        scrap: typeof wo.scrap === "number" ? Math.trunc(wo.scrap) : null,

        // Counters
        cycleCount: typeof body.cycle_count === "number" ? body.cycle_count : null,
        goodParts: typeof body.good_parts === "number" ? body.good_parts : null,
        scrapParts: typeof body.scrap_parts === "number" ? body.scrap_parts : null,
        cavities: safeCavities,

        // Cycle times
        cycleTime: safeCycleTime,
        actualCycle: typeof body.actualCycleTime === "number" ? body.actualCycleTime : null,

        // KPIs (0..100)
        availability: typeof k.availability === "number" ? k.availability : null,
        performance: typeof k.performance === "number" ? k.performance : null,
        quality: typeof k.quality === "number" ? k.quality : null,
        oee: typeof k.oee === "number" ? k.oee : null,

        trackingEnabled: typeof body.trackingEnabled === "boolean" ? body.trackingEnabled : null,
        productionStarted: typeof body.productionStarted === "boolean" ? body.productionStarted : null,
      },
    });

    // Optional but useful: update machine "last seen" meta fields
    await prisma.machine.update({
      where: { id: machine.id },
      data: {
        schemaVersion,
        seq,
        tsDevice: tsDeviceDate,
        tsServer: new Date(),
      },
    });

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
      id: row.id,
      tsDevice: row.ts,
      tsServer: row.tsServer,
    });
  } catch (err: any) {
    const msg = err?.message ? String(err.message) : "Unknown error";

    // Never fail the request because logging failed
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
  } finally {
    // (If later you add latency_ms to IngestLog, you can store Date.now() - startedAt here.)
    void startedAt;
  }
}
