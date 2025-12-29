// /home/mdares/mis-control-tower/lib/contracts/v1.ts
import { z } from "zod";

/**
 * Phase 0: freeze schema version string now and never change it without bumping.
 * If you later create v2, make a new file or new constant.
 */
export const SCHEMA_VERSION = "1.0";

// KPI scale is frozen as 0..100 (you confirmed)
const KPI_0_100 = z.number().min(0).max(100);

export const SnapshotV1 = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    machineId: z.string().uuid(),
    tsDevice: z.number().int().nonnegative(), // epoch ms
    // IMPORTANT: seq should be sent as string if it can ever exceed JS safe int
    seq: z.union([z.number().int().nonnegative(), z.string().regex(/^\d+$/)]),

    // current shape (keep it flat so Node-RED changes are minimal)
    activeWorkOrder: z
      .object({
        id: z.string(),
        sku: z.string().optional(),
        target: z.number().optional(),
        good: z.number().optional(),
        scrap: z.number().optional(),
      })
      .partial()
      .optional(),

    cycle_count: z.number().int().nonnegative().optional(),
    good_parts: z.number().int().nonnegative().optional(),
    scrap_parts: z.number().int().nonnegative().optional(),
    cavities: z.number().int().positive().optional(),

    cycleTime: z.number().nonnegative().optional(), // theoretical/target cycle time
    actualCycleTime: z.number().nonnegative().optional(), // optional

    trackingEnabled: z.boolean().optional(),
    productionStarted: z.boolean().optional(),

    kpis: z.object({
      oee: KPI_0_100,
      availability: KPI_0_100,
      performance: KPI_0_100,
      quality: KPI_0_100,
    }),
  })
  .passthrough();

/**
 * TEMPORARY: Accept your current legacy payload while Node-RED is not sending
 * schemaVersion/tsDevice/seq yet. Remove this once edge is upgraded.
 */
const SnapshotLegacy = z
  .object({
    machineId: z.any(),
    kpis: z.any(),
  })
  .passthrough();

export type SnapshotV1Type = z.infer<typeof SnapshotV1>;

export function normalizeSnapshotV1(raw: unknown): { ok: true; value: SnapshotV1Type } | { ok: false; error: string } {
  const strict = SnapshotV1.safeParse(raw);
  if (strict.success) return { ok: true, value: strict.data };

  // Legacy fallback (temporary)
  const legacy = SnapshotLegacy.safeParse(raw);
  if (!legacy.success) {
    return { ok: false, error: strict.error.message };
  }

  const b: any = legacy.data;

  // Build a "best effort" SnapshotV1 so ingest works during transition.
  // seq is intentionally set to "0" if missing (so you can still store);
  // once Node-RED emits real seq, dedupe and ordering become reliable.
  const migrated: any = {
    schemaVersion: SCHEMA_VERSION,
    machineId: String(b.machineId),
    tsDevice: typeof b.tsDevice === "number" ? b.tsDevice : Date.now(),
    seq: typeof b.seq === "number" || typeof b.seq === "string" ? b.seq : "0",
    ...b,
  };

  const recheck = SnapshotV1.safeParse(migrated);
  if (!recheck.success) return { ok: false, error: recheck.error.message };
  return { ok: true, value: recheck.data };
}

const HeartbeatV1 = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  machineId: z.string().uuid(),
  tsDevice: z.number().int().nonnegative(),
  seq: z.union([z.number().int().nonnegative(), z.string().regex(/^\d+$/)]),

  // legacy shape you currently send: status/message/ip/fwVersion
  status: z.string().optional(),
  message: z.string().optional(),
  ip: z.string().optional(),
  fwVersion: z.string().optional(),

  // new canonical boolean
  online: z.boolean().optional(),
}).passthrough();

export function normalizeHeartbeatV1(raw: unknown) {
  const strict = HeartbeatV1.safeParse(raw);
  if (strict.success) return { ok: true as const, value: strict.data };

  // legacy fallback: allow missing meta
  const legacy = z.object({ machineId: z.any() }).passthrough().safeParse(raw);
  if (!legacy.success) return { ok: false as const, error: strict.error.message };

  const b: any = legacy.data;
  const migrated: any = {
    schemaVersion: SCHEMA_VERSION,
    machineId: String(b.machineId),
    tsDevice: typeof b.tsDevice === "number" ? b.tsDevice : Date.now(),
    seq: typeof b.seq === "number" || typeof b.seq === "string" ? b.seq : "0",
    ...b,
  };

  const recheck = HeartbeatV1.safeParse(migrated);
  if (!recheck.success) return { ok: false as const, error: recheck.error.message };
  return { ok: true as const, value: recheck.data };
}

const CycleV1 = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  machineId: z.string().uuid(),
  tsDevice: z.number().int().nonnegative(),
  seq: z.union([z.number().int().nonnegative(), z.string().regex(/^\d+$/)]),

  cycle: z.object({
    timestamp: z.number().int().positive(),
    cycle_count: z.number().int().nonnegative(),
    actual_cycle_time: z.number(),
    theoretical_cycle_time: z.number().optional(),
    work_order_id: z.string(),
    sku: z.string().optional(),
    cavities: z.number().optional(),
    good_delta: z.number().optional(),
    scrap_total: z.number().optional(),
  }).passthrough(),
}).passthrough();

export function normalizeCycleV1(raw: unknown) {
  const strict = CycleV1.safeParse(raw);
  if (strict.success) return { ok: true as const, value: strict.data };

  // legacy fallback: { machineId, cycle }
  const legacy = z.object({ machineId: z.any(), cycle: z.any() }).passthrough().safeParse(raw);
  if (!legacy.success) return { ok: false as const, error: strict.error.message };

  const b: any = legacy.data;
  const tsDevice = typeof b.tsDevice === "number" ? b.tsDevice : (b.cycle?.timestamp ?? Date.now());
  const seq = typeof b.seq === "number" || typeof b.seq === "string" ? b.seq : (b.cycle?.cycle_count ?? "0");

  const migrated: any = { schemaVersion: SCHEMA_VERSION, machineId: String(b.machineId), tsDevice, seq, ...b };
  const recheck = CycleV1.safeParse(migrated);
  if (!recheck.success) return { ok: false as const, error: recheck.error.message };
  return { ok: true as const, value: recheck.data };
}

const EventV1 = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  machineId: z.string().uuid(),
  tsDevice: z.number().int().nonnegative(),
  seq: z.union([z.number().int().nonnegative(), z.string().regex(/^\d+$/)]),

  // IMPORTANT: event must be an object, not an array
  event: z.object({
    anomaly_type: z.string(),
    severity: z.string(),
    title: z.string(),
    description: z.string().optional(),
    timestamp: z.number().int().positive(),
    work_order_id: z.string(),
    cycle_count: z.number().optional(),
    data: z.any().optional(),
    kpi_snapshot: z.any().optional(),
  }).passthrough(),
}).passthrough();

export function normalizeEventV1(raw: unknown) {
  const strict = EventV1.safeParse(raw);
  if (strict.success) return { ok: true as const, value: strict.data };

  // legacy fallback: allow missing meta, but STILL reject arrays later
  const legacy = z.object({ machineId: z.any(), event: z.any() }).passthrough().safeParse(raw);
  if (!legacy.success) return { ok: false as const, error: strict.error.message };

  const b: any = legacy.data;
  const tsDevice = typeof b.tsDevice === "number" ? b.tsDevice : (b.event?.timestamp ?? Date.now());
  const migrated: any = {
    schemaVersion: SCHEMA_VERSION,
    machineId: String(b.machineId),
    tsDevice,
    seq: typeof b.seq === "number" || typeof b.seq === "string" ? b.seq : "0",
    ...b,
  };

  const recheck = EventV1.safeParse(migrated);
  if (!recheck.success) return { ok: false as const, error: recheck.error.message };
  return { ok: true as const, value: recheck.data };
}
