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
    // `scrap_total` is cumulative and should not be persisted as per-cycle delta.
    scrap_delta: fromRowOrData(["scrap_delta", "scrapDelta"]),
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

// Max plausible startup-wait window. Beyond this the machine was almost
// certainly idle/abandoned rather than "awaiting startup", so we don't record it.
const STARTUP_WAIT_MAX_MS = 12 * 60 * 60 * 1000;
const STARTUP_WAIT_LOOKBACK_MS = 24 * 60 * 60 * 1000;

function eventDataObject(data: unknown): Record<string, unknown> {
  let parsed: unknown = data;
  if (typeof parsed === "string") {
    try { parsed = JSON.parse(parsed); } catch { parsed = null; }
  }
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

/**
 * Find the most recent resolved mold-change (its end_ms swap marker, plus a
 * stable episode key) for a machine, looking back STARTUP_WAIT_LOOKBACK_MS.
 */
async function latestResolvedMoldChange(orgId: string, machineId: string) {
  const since = new Date(Date.now() - STARTUP_WAIT_LOOKBACK_MS);
  const events = await prisma.machineEvent.findMany({
    where: { orgId, machineId, eventType: "mold-change", ts: { gte: since } },
    orderBy: { ts: "desc" },
    take: 50,
    select: { ts: true, data: true },
  });

  for (const event of events) {
    const data = eventDataObject(event.data);
    const status = String(data.status ?? "").trim().toLowerCase();
    if (status !== "resolved") continue;
    const endRaw = asNumber(data.end_ms) ?? asNumber(data.endMs);
    if (endRaw == null || endRaw <= 0) continue;
    const startRaw = asNumber(data.start_ms) ?? asNumber(data.startMs);
    const incidentKey =
      (typeof data.incidentKey === "string" && data.incidentKey.trim()) ||
      (typeof data.incident_key === "string" && (data.incident_key as string).trim()) ||
      (startRaw != null ? `mold-change:${Math.trunc(startRaw)}` : `mold-change:${Math.trunc(endRaw)}`);
    return { endMs: Math.trunc(endRaw), incidentKey };
  }
  return null;
}

async function recordStartupWaitReason(
  orgId: string,
  machineId: string,
  rows: Array<{ ts: Date; workOrderId: string | null }>,
) {
  if (!rows.length) return;
  const minNewCycleMs = Math.min(...rows.map((row) => row.ts.getTime()));

  const mold = await latestResolvedMoldChange(orgId, machineId);
  if (!mold) return;
  // Only relevant if this batch contributed a cycle after the swap finished.
  if (minNewCycleMs <= mold.endMs) return;

  // The window closes at the FIRST cycle after the swap (may predate this batch).
  const firstCycle = await prisma.machineCycle.findFirst({
    where: { orgId, machineId, ts: { gt: new Date(mold.endMs) } },
    orderBy: { ts: "asc" },
    select: { ts: true, workOrderId: true },
  });
  if (!firstCycle) return;

  const firstCycleMs = firstCycle.ts.getTime();
  const gapMs = firstCycleMs - mold.endMs;
  if (gapMs <= 0 || gapMs > STARTUP_WAIT_MAX_MS) return;

  const episodeId = `startup-wait:${mold.incidentKey}`;
  const reasonId = `evt:${machineId}:downtime:${episodeId}`;
  const durationSeconds = Math.max(0, Math.trunc(gapMs / 1000));
  const meta = {
    source: "ingest:cycle",
    incidentKey: episodeId,
    moldIncidentKey: mold.incidentKey,
    moldEndMs: mold.endMs,
    firstCycleMs,
    reason: {
      type: "downtime",
      categoryId: "espera-arranque",
      categoryLabel: "En espera de arranque",
      detailId: "espera-arranque",
      detailLabel: "En espera de arranque",
      reasonText: "En espera de arranque",
    },
  };

  await prisma.reasonEntry.upsert({
    where: { orgId_kind_episodeId: { orgId, kind: "downtime", episodeId } },
    create: {
      orgId,
      machineId,
      reasonId,
      kind: "downtime",
      episodeId,
      durationSeconds,
      episodeEndTs: new Date(firstCycleMs),
      reasonCode: "ESPERA_ARRANQUE",
      reasonLabel: "En espera de arranque",
      reasonText: "En espera de arranque",
      capturedAt: new Date(firstCycleMs),
      workOrderId: firstCycle.workOrderId ?? rows[0].workOrderId ?? null,
      schemaVersion: 1,
      meta,
    },
    update: {
      durationSeconds,
      episodeEndTs: new Date(firstCycleMs),
      reasonCode: "ESPERA_ARRANQUE",
      reasonLabel: "En espera de arranque",
      reasonText: "En espera de arranque",
      meta,
    },
  });
}

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

  const result = await prisma.machineCycle.createMany({
    data: rows,
    skipDuplicates: true,
  });

  // "En espera de arranque": when this batch's first cycle resumes production
  // after a resolved mold-change that had no cycle yet, record the gap from the
  // swap end to that first cycle as an ESPERA_ARRANQUE downtime ReasonEntry so it
  // flows into Pareto / recap / the downtime list as an unplanned reason.
  // Idempotent on the mold incidentKey via the (orgId, kind, episodeId) unique.
  await recordStartupWaitReason(machine.orgId, machine.id, rows).catch(() => {
    // Never let this derivation break cycle ingest.
  });

  if (rows.length === 1) {
    const row = await prisma.machineCycle.findFirst({
      where: {
        orgId: machine.orgId,
        machineId: machine.id,
        ts: rows[0].ts,
        cycleCount: rows[0].cycleCount ?? null,
      },
      orderBy: { createdAt: "asc" },
      select: { id: true, ts: true },
    });
    return NextResponse.json({
      ok: true,
      id: row?.id,
      ts: row?.ts,
      inserted: result.count,
      duplicate: result.count === 0,
    });
  }

  return NextResponse.json({
    ok: true,
    inserted: result.count,
    requested: rows.length,
    count: result.count,
  });
}
