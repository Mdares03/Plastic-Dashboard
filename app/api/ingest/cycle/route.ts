import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getMachineAuth } from "@/lib/machineAuthCache";
import { z } from "zod";

function unwrapEnvelope(raw: any) {
  if (!raw || typeof raw !== "object") return raw;
  const payload = raw.payload;
  if (!payload || typeof payload !== "object") return raw;

  const hasMeta =
    raw.schemaVersion !== undefined ||
    raw.machineId !== undefined ||
    raw.tsMs !== undefined ||
    raw.tsDevice !== undefined ||
    raw.seq !== undefined ||
    raw.type !== undefined;
  if (!hasMeta) return raw;

  return {
    ...payload,
    machineId: raw.machineId ?? payload.machineId,
    tsMs: raw.tsMs ?? payload.tsMs,
    tsDevice: raw.tsDevice ?? payload.tsDevice,
    schemaVersion: raw.schemaVersion ?? payload.schemaVersion,
    seq: raw.seq ?? payload.seq,
  };
}

const numberFromAny = z.preprocess((value) => {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "") return Number(value);
  return value;
}, z.number().finite());

const intFromAny = z.preprocess((value) => {
  if (typeof value === "number") return Math.trunc(value);
  if (typeof value === "string" && value.trim() !== "") return Math.trunc(Number(value));
  return value;
}, z.number().int().finite());

const machineIdSchema = z.string().uuid();

const cycleSchema = z
  .object({
    actual_cycle_time: numberFromAny,
    theoretical_cycle_time: numberFromAny.optional(),
    cycle_count: intFromAny.optional(),
    work_order_id: z.string().trim().max(64).optional(),
    sku: z.string().trim().max(64).optional(),
    cavities: intFromAny.optional(),
    good_delta: intFromAny.optional(),
    scrap_delta: intFromAny.optional(),
    timestamp: numberFromAny.optional(),
    ts: numberFromAny.optional(),
    event_timestamp: numberFromAny.optional(),
  })
  .passthrough();

export async function POST(req: Request) {
  const apiKey = req.headers.get("x-api-key");
  if (!apiKey) return NextResponse.json({ ok: false, error: "Missing api key" }, { status: 401 });

  let body = await req.json().catch(() => null);
  body = unwrapEnvelope(body);

  const machineId = body?.machineId ?? body?.machine_id ?? body?.machine?.id;
  if (!machineId || !machineIdSchema.safeParse(String(machineId)).success) {
    return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
  }

  const machine = await getMachineAuth(String(machineId), apiKey);
  if (!machine) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const raw = body as any;
  const cyclesRaw = raw?.cycles ?? raw?.cycle;
  if (!cyclesRaw) {
    return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
  }

  const cycleList = Array.isArray(cyclesRaw) ? cyclesRaw : [cyclesRaw];
  const parsedCycles = z.array(cycleSchema).safeParse(cycleList);
  if (!parsedCycles.success) {
    return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
  }

  const fallbackTsMs =
    (typeof raw?.tsMs === "number" && raw.tsMs) ||
    (typeof raw?.tsDevice === "number" && raw.tsDevice) ||
    undefined;

  const rows = parsedCycles.data.map((data) => {
    const tsMs =
      (typeof data.timestamp === "number" && data.timestamp) ||
      (typeof data.ts === "number" && data.ts) ||
      (typeof data.event_timestamp === "number" && data.event_timestamp) ||
      fallbackTsMs;

    const ts = tsMs ? new Date(tsMs) : new Date();

    return {
      orgId: machine.orgId,
      machineId: machine.id,
      ts,
      cycleCount: typeof data.cycle_count === "number" ? data.cycle_count : null,
      actualCycleTime: data.actual_cycle_time,
      theoreticalCycleTime: typeof data.theoretical_cycle_time === "number" ? data.theoretical_cycle_time : null,
      workOrderId: data.work_order_id ? String(data.work_order_id) : null,
      sku: data.sku ? String(data.sku) : null,
      cavities: typeof data.cavities === "number" ? data.cavities : null,
      goodDelta: typeof data.good_delta === "number" ? data.good_delta : null,
      scrapDelta: typeof data.scrap_delta === "number" ? data.scrap_delta : null,
    };
  });

  if (rows.length === 1) {
    const row = await prisma.machineCycle.create({ data: rows[0] });
    return NextResponse.json({ ok: true, id: row.id, ts: row.ts });
  }

  const result = await prisma.machineCycle.createMany({ data: rows });
  return NextResponse.json({ ok: true, count: result.count });
}
