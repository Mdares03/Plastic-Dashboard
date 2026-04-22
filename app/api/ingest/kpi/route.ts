// mis-control-tower/app/api/ingest/kpi/route.ts
import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getMachineAuth } from "@/lib/machineAuthCache";
import { normalizeSnapshotV1 } from "@/lib/contracts/v1";
import { toJsonValue } from "@/lib/prismaJson";
import { logLine } from "@/lib/logger";

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

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readPath(root: unknown, path: string[]): unknown {
  let current = root;
  for (const key of path) {
    const record = asRecord(current);
    if (!record) return undefined;
    current = record[key];
  }
  return current;
}

function collectQualityTrace(params: {
  rawBody: unknown;
  normalizedKpis: Record<string, unknown> | null;
  persistedQuality: number | null;
  machineId: string;
  rowId: string;
}) {
  const { rawBody, normalizedKpis, persistedQuality, machineId, rowId } = params;
  const candidates = [
    "kpis.quality",
    "payload.kpis.quality",
    "kpi_snapshot.quality",
    "quality",
    "payload.quality",
  ] as const;

  const rawQualityCandidates: Record<string, { type: string; value: unknown }> = {};
  for (const path of candidates) {
    const value = readPath(rawBody, path.split("."));
    rawQualityCandidates[path] = {
      type: value === null ? "null" : typeof value,
      value,
    };
  }

  const normalizedQuality = normalizedKpis?.quality;
  return {
    machineId,
    rowId,
    rawQualityCandidates,
    normalizedQuality: {
      type: normalizedQuality === null ? "null" : typeof normalizedQuality,
      value: normalizedQuality ?? null,
    },
    persistedQuality: {
      type: persistedQuality === null ? "null" : typeof persistedQuality,
      value: persistedQuality,
    },
  };
}

export async function POST(req: Request) {
  const endpoint = "/api/ingest/kpi";
  const startedAt = Date.now();
  const ip = getClientIp(req);
  const userAgent = req.headers.get("user-agent");
  const traceEnabled = process.env.TRACE_KPI_INGEST === "1" || req.headers.get("x-debug-ingest") === "1";

  let rawBody: unknown = null;
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
          body: toJsonValue(rawBody),
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
    const machine = await getMachineAuth(machineId, apiKey);

    if (!machine) {
      await prisma.ingestLog.create({
        data: {
          endpoint,
          ok: false,
          status: 401,
          errorCode: "UNAUTHORIZED",
          errorMsg: "Unauthorized (machineId/apiKey mismatch)",
          body: toJsonValue(rawBody),
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

    const woRecord = (body.activeWorkOrder ?? {}) as Record<string, unknown>;
    const good =
      typeof woRecord.good === "number"
        ? woRecord.good
        : typeof woRecord.goodParts === "number"
          ? woRecord.goodParts
          : typeof woRecord.good_parts === "number"
            ? woRecord.good_parts
            : null;
    const scrap =
      typeof woRecord.scrap === "number"
        ? woRecord.scrap
        : typeof woRecord.scrapParts === "number"
          ? woRecord.scrapParts
          : typeof woRecord.scrap_parts === "number"
            ? woRecord.scrap_parts
            : null;
    const k = body.kpis ?? {};
    const safeCycleTime =
      typeof body.cycleTime === "number" && body.cycleTime > 0
        ? body.cycleTime
        : typeof woRecord.cycleTime === "number" && woRecord.cycleTime > 0
          ? woRecord.cycleTime
          : null;

    const safeCavities =
      typeof body.cavities === "number" && body.cavities > 0
        ? body.cavities
        : typeof woRecord.cavities === "number" && woRecord.cavities > 0
          ? woRecord.cavities
          : null;
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
        workOrderId: woRecord.id != null ? String(woRecord.id) : null,
        sku: woRecord.sku != null ? String(woRecord.sku) : null,
        target: typeof woRecord.target === "number" ? Math.trunc(woRecord.target) : null,
        good: good != null ? Math.trunc(good) : null,
        scrap: scrap != null ? Math.trunc(scrap) : null,

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

    const trace = collectQualityTrace({
      rawBody,
      normalizedKpis: asRecord(k),
      persistedQuality: row.quality ?? null,
      machineId: machine.id,
      rowId: row.id,
    });
    if (traceEnabled) {
      logLine("ingest.kpi.trace", {
        endpoint,
        machineId: machine.id,
        orgId,
        schemaVersion,
        seq: seq != null ? seq.toString() : null,
        ip,
        userAgent,
        trace,
        rawBody: toJsonValue(rawBody),
      });
    }

    return NextResponse.json({
      ok: true,
      id: row.id,
      tsDevice: row.ts,
      tsServer: row.tsServer,
      trace: traceEnabled ? trace : undefined,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Unknown error";

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
          body: toJsonValue(rawBody),
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
