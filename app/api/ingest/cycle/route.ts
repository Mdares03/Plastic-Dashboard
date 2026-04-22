import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getMachineAuth } from "@/lib/machineAuthCache";
import { z } from "zod";

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function unwrapEnvelope(raw: unknown) {
  const record = asRecord(raw);
  if (!record) return raw;
  const payload = asRecord(record.payload);
  if (!payload) return raw;

  const hasMeta =
    record.schemaVersion !== undefined ||
    record.machineId !== undefined ||
    record.tsMs !== undefined ||
    record.tsDevice !== undefined ||
    record.seq !== undefined ||
    record.type !== undefined;
  if (!hasMeta) return raw;

  return {
    ...payload,
    machineId: record.machineId ?? payload.machineId,
    tsMs: record.tsMs ?? payload.tsMs,
    tsDevice: record.tsDevice ?? payload.tsDevice,
    schemaVersion: record.schemaVersion ?? payload.schemaVersion,
    seq: record.seq ?? payload.seq,
  };
}

function asNumber(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function normalizeCycleInput(raw: unknown): Record<string, unknown> | null {
  const row = asRecord(raw);
  if (!row) return null;
  const data = asRecord(row.data);

  const fromRowOrData = (keys: string[]) => {
    for (const key of keys) {
      if (row[key] !== undefined) return row[key];
      if (data && data[key] !== undefined) return data[key];
    }
    return undefined;
  };

  return {
    ...row,
    actual_cycle_time: fromRowOrData(["actual_cycle_time", "actualCycleTime", "actual_cycle", "actual"]),
    theoretical_cycle_time: fromRowOrData([
      "theoretical_cycle_time",
      "theoreticalCycleTime",
      "cycleTime",
      "cycle_time",
      "ideal",
    ]),
    cycle_count: fromRowOrData(["cycle_count", "cycleCount"]),
    work_order_id: fromRowOrData(["work_order_id", "workOrderId"]),
    good_delta: fromRowOrData(["good_delta", "goodDelta"]),
    scrap_delta: fromRowOrData(["scrap_delta", "scrapDelta", "scrap_total"]),
    timestamp: fromRowOrData(["timestamp", "tsMs"]),
    ts: fromRowOrData(["ts", "tsMs"]),
    event_timestamp: fromRowOrData(["event_timestamp", "eventTimestamp"]),
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

  let body: unknown = await req.json().catch(() => null);
  body = unwrapEnvelope(body);
  const bodyRecord = asRecord(body) ?? {};

  const machineId =
    bodyRecord.machineId ??
    bodyRecord.machine_id ??
    (asRecord(bodyRecord.machine)?.id ?? null);
  if (!machineId || !machineIdSchema.safeParse(String(machineId)).success) {
    return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
  }

  const machine = await getMachineAuth(String(machineId), apiKey);
  if (!machine) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const cyclesRaw = bodyRecord.cycles ?? bodyRecord.cycle;
  if (!cyclesRaw) {
    return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
  }

  const cycleList = (Array.isArray(cyclesRaw) ? cyclesRaw : [cyclesRaw])
    .map((row) => normalizeCycleInput(row))
    .filter((row): row is Record<string, unknown> => !!row);

  if (!cycleList.length) {
    return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
  }

  const parsedCycles = z.array(cycleSchema).safeParse(cycleList);
  if (!parsedCycles.success) {
    return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
  }

  const fallbackTsMs =
    asNumber(bodyRecord.tsMs) ||
    asNumber(bodyRecord.tsDevice) ||
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
