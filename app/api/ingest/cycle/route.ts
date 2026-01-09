import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
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

const cyclePayloadSchema = z
  .object({
    machineId: z.string().uuid(),
    cycle: z
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
      .passthrough(),
  })
  .passthrough();

export async function POST(req: Request) {
  const apiKey = req.headers.get("x-api-key");
  if (!apiKey) return NextResponse.json({ ok: false, error: "Missing api key" }, { status: 401 });

  let body = await req.json().catch(() => null);
  body = unwrapEnvelope(body);

  const parsed = cyclePayloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
  }

  const machine = await prisma.machine.findFirst({
    where: { id: parsed.data.machineId, apiKey },
    select: { id: true, orgId: true },
  });
  if (!machine) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const c = parsed.data.cycle;
  const raw = body as any;

  const tsMs =
    (typeof c.timestamp === "number" && c.timestamp) ||
    (typeof c.ts === "number" && c.ts) ||
    (typeof c.event_timestamp === "number" && c.event_timestamp) ||
    (typeof raw?.tsMs === "number" && raw.tsMs) ||
    (typeof raw?.tsDevice === "number" && raw.tsDevice) ||
    undefined;

  const ts = tsMs ? new Date(tsMs) : new Date();

  const row = await prisma.machineCycle.create({
    data: {
      orgId: machine.orgId,
      machineId: machine.id,
      ts,
      cycleCount: typeof c.cycle_count === "number" ? c.cycle_count : null,
      actualCycleTime: c.actual_cycle_time,
      theoreticalCycleTime: typeof c.theoretical_cycle_time === "number" ? c.theoretical_cycle_time : null,
      workOrderId: c.work_order_id ? String(c.work_order_id) : null,
      sku: c.sku ? String(c.sku) : null,
      cavities: typeof c.cavities === "number" ? c.cavities : null,
      goodDelta: typeof c.good_delta === "number" ? c.good_delta : null,
      scrapDelta: typeof c.scrap_delta === "number" ? c.scrap_delta : null,
    },
  });
  return NextResponse.json({ ok: true, id: row.id, ts: row.ts });
}
