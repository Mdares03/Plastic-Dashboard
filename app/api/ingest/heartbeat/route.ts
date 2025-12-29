import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizeHeartbeatV1 } from "@/lib/contracts/v1";

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
  const endpoint = "/api/ingest/heartbeat";
  const ip = getClientIp(req);
  const userAgent = req.headers.get("user-agent");

  let rawBody: any = null;
  let orgId: string | null = null;
  let machineId: string | null = null;
  let seq: bigint | null = null;
  let schemaVersion: string | null = null;
  let tsDeviceDate: Date | null = null;

  try {
    // 1) Auth header exists
    const apiKey = req.headers.get("x-api-key");
    if (!apiKey) {
      await prisma.ingestLog.create({
        data: { endpoint, ok: false, status: 401, errorCode: "MISSING_API_KEY", errorMsg: "Missing api key", ip, userAgent },
      });
      return NextResponse.json({ ok: false, error: "Missing api key" }, { status: 401 });
    }

    // 2) Parse JSON
    rawBody = await req.json().catch(() => null);

    // 3) Normalize to v1 (legacy tolerated)
    const normalized = normalizeHeartbeatV1(rawBody);
    if (!normalized.ok) {
      await prisma.ingestLog.create({
        data: { endpoint, ok: false, status: 400, errorCode: "INVALID_PAYLOAD", errorMsg: normalized.error, body: rawBody, ip, userAgent },
      });
      return NextResponse.json({ ok: false, error: "Invalid payload", detail: normalized.error }, { status: 400 });
    }

    const body = normalized.value;
    schemaVersion = body.schemaVersion;
    machineId = body.machineId;
    seq = parseSeqToBigInt(body.seq);
    tsDeviceDate = new Date(body.tsDevice);

    // 4) Authorize machineId + apiKey
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

    // 5) Store heartbeat
    // Keep your legacy fields, but store meta fields too.
    const hb = await prisma.machineHeartbeat.create({
      data: {
        orgId,
        machineId: machine.id,

        // Phase 0 meta
        schemaVersion,
        seq,
        ts: tsDeviceDate,

        // Legacy payload compatibility
        status: body.status ? String(body.status) : (body.online ? "RUN" : "STOP"),
        message: body.message ? String(body.message) : null,
        ip: body.ip ? String(body.ip) : null,
        fwVersion: body.fwVersion ? String(body.fwVersion) : null,
      },
    });

    // Optional: update machine last seen (same as KPI)
    await prisma.machine.update({
      where: { id: machine.id },
      data: {
        schemaVersion,
        seq,
        tsDevice: tsDeviceDate,
        tsServer: new Date(),
      },
    });

    // 6) Ingest log success
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
      id: hb.id,
      tsDevice: hb.ts,
      tsServer: hb.tsServer,
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
