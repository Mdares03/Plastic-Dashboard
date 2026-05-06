import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/requireSession";
import { toJsonValue } from "@/lib/prismaJson";
import {
  DEFAULT_ALERTS,
  DEFAULT_DEFAULTS,
  DEFAULT_SHIFT,
  applyOverridePatch,
  buildSettingsPayload,
  deepMerge,
  validateDefaults,
  validateShiftFields,
  validateShiftSchedule,
  validateShiftOverrides,
  validateThresholds,
} from "@/lib/settings";
import { effectiveReasonCatalogForOrg } from "@/lib/reasonCatalogDb";
import { publishSettingsUpdate } from "@/lib/mqtt";
import { z } from "zod";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function canManageSettings(role?: string | null) {
  return role === "OWNER" || role === "ADMIN";
}

const machineIdSchema = z.string().uuid();
const machineSettingsSchema = z
  .object({
    source: z.string().trim().max(40).optional(),
    overrides: z.any().optional(),
  })
  .passthrough();

function pickAllowedOverrides(raw: unknown) {
  if (!isPlainObject(raw)) return {};
  const out: Record<string, unknown> = {};
  for (const key of ["shiftSchedule", "thresholds", "alerts", "defaults"]) {
    if (raw[key] !== undefined) out[key] = raw[key];
  }
  return out;
}

async function attachReasonCatalog(
  orgId: string,
  defaultsJson: unknown,
  settingsVersion: number,
  base: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const catalog = await effectiveReasonCatalogForOrg(orgId, defaultsJson, settingsVersion);
  return {
    ...base,
    reasonCatalog: catalog,
    reasonCatalogData: catalog,
    reasonCatalogVersion: Number(catalog.version || 1),
  };
}

async function ensureOrgSettings(
  tx: Prisma.TransactionClient,
  orgId: string,
  userId?: string | null
) {
  let settings = await tx.orgSettings.findUnique({
    where: { orgId },
  });

  if (settings) {
    let shifts = await tx.orgShift.findMany({
      where: { orgId },
      orderBy: { sortOrder: "asc" },
    });
    if (!shifts.length) {
      await tx.orgShift.create({
        data: {
          orgId,
          name: DEFAULT_SHIFT.name,
          startTime: DEFAULT_SHIFT.start,
          endTime: DEFAULT_SHIFT.end,
          sortOrder: 1,
          enabled: true,
        },
      });
      shifts = await tx.orgShift.findMany({
        where: { orgId },
        orderBy: { sortOrder: "asc" },
      });
    }
    return { settings, shifts };
  }

  settings = await tx.orgSettings.create({
    data: {
      orgId,
      timezone: "UTC",
      shiftChangeCompMin: 10,
      lunchBreakMin: 30,
      stoppageMultiplier: 1.5,
      macroStoppageMultiplier: 5,
      oeeAlertThresholdPct: 90,
      performanceThresholdPct: 85,
      qualitySpikeDeltaPct: 5,
      alertsJson: DEFAULT_ALERTS,
      defaultsJson: DEFAULT_DEFAULTS,
      updatedBy: userId ?? null,
    },
  });

  await tx.orgShift.create({
    data: {
      orgId,
      name: DEFAULT_SHIFT.name,
      startTime: DEFAULT_SHIFT.start,
      endTime: DEFAULT_SHIFT.end,
      sortOrder: 1,
      enabled: true,
    },
  });

  const shifts = await tx.orgShift.findMany({
    where: { orgId },
    orderBy: { sortOrder: "asc" },
  });
  return { settings, shifts };
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ machineId: string }> }
) {
  const { machineId } = await params;
  if (!machineIdSchema.safeParse(machineId).success) {
    return NextResponse.json({ ok: false, error: "Invalid machine id" }, { status: 400 });
  }

  const session = await requireSession();
  let orgId: string | null = null;
  let userId: string | null = null;
  let machine: { id: string; orgId: string } | null = null;

  if (session) {
    machine = await prisma.machine.findFirst({
      where: { id: machineId, orgId: session.orgId },
      select: { id: true, orgId: true },
    });
    if (!machine) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    orgId = machine.orgId;
    userId = session.userId;
  } else {
    const apiKey = req.headers.get("x-api-key");
    if (!apiKey) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    machine = await prisma.machine.findFirst({
      where: { id: machineId, apiKey },
      select: { id: true, orgId: true },
    });
    if (!machine) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    orgId = machine.orgId;
  }
  const { orgRow, shifts, rawOverrides } = await prisma.$transaction(async (tx) => {
    const orgSettings = await ensureOrgSettings(tx, orgId as string, userId);
    if (!orgSettings?.settings) throw new Error("SETTINGS_NOT_FOUND");

    const machineSettings = await tx.machineSettings.findUnique({
      where: { machineId },
      select: { overridesJson: true },
    });

    const rawOverrides = pickAllowedOverrides(machineSettings?.overridesJson ?? {});
    return {
      orgRow: orgSettings.settings,
      shifts: orgSettings.shifts ?? [],
      rawOverrides,
    };
  });

  const baseOrg = buildSettingsPayload(orgRow, shifts) as Record<string, unknown>;
  const orgPayload = await attachReasonCatalog(orgId as string, orgRow.defaultsJson, orgRow.version, baseOrg);
  const effective = deepMerge(orgPayload, rawOverrides) as Record<string, unknown>;

  return NextResponse.json({
    ok: true,
    machineId,
    orgSettings: orgPayload,
    effectiveSettings: effective,
    overrides: rawOverrides,
  });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ machineId: string }> }
) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const membership = await prisma.orgUser.findUnique({
    where: { orgId_userId: { orgId: session.orgId, userId: session.userId } },
    select: { role: true },
  });
  if (!canManageSettings(membership?.role)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const { machineId } = await params;
  if (!machineIdSchema.safeParse(machineId).success) {
    return NextResponse.json({ ok: false, error: "Invalid machine id" }, { status: 400 });
  }

  const machine = await prisma.machine.findFirst({
    where: { id: machineId, orgId: session.orgId },
    select: { id: true },
  });

  if (!machine) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const parsed = machineSettingsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid settings payload" }, { status: 400 });
  }
  const source = String(parsed.data.source ?? "control_tower");

  let patch = parsed.data.overrides ?? parsed.data;
  if (patch === null) {
    patch = null;
  }

  if (patch && !isPlainObject(patch)) {
    return NextResponse.json({ ok: false, error: "overrides must be an object or null" }, { status: 400 });
  }

  if (patch && Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: false, error: "No overrides provided" }, { status: 400 });
  }

  if (patch && Object.keys(pickAllowedOverrides(patch)).length !== Object.keys(patch).length) {
    return NextResponse.json({ ok: false, error: "overrides contain unsupported keys" }, { status: 400 });
  }

  if (patch?.shiftSchedule && !isPlainObject(patch.shiftSchedule)) {
    return NextResponse.json({ ok: false, error: "shiftSchedule must be an object" }, { status: 400 });
  }
  if (patch?.thresholds !== undefined && patch.thresholds !== null && !isPlainObject(patch.thresholds)) {
    return NextResponse.json({ ok: false, error: "thresholds must be an object" }, { status: 400 });
  }
  if (patch?.alerts !== undefined && patch.alerts !== null && !isPlainObject(patch.alerts)) {
    return NextResponse.json({ ok: false, error: "alerts must be an object" }, { status: 400 });
  }
  if (patch?.defaults !== undefined && patch.defaults !== null && !isPlainObject(patch.defaults)) {
    return NextResponse.json({ ok: false, error: "defaults must be an object" }, { status: 400 });
  }

  const shiftValidation = validateShiftFields(
    patch?.shiftSchedule?.shiftChangeCompensationMin,
    patch?.shiftSchedule?.lunchBreakMin
  );
  if (!shiftValidation.ok) {
    return NextResponse.json({ ok: false, error: shiftValidation.error }, { status: 400 });
  }

  const overridesResult =
    patch?.shiftSchedule?.overrides !== undefined
      ? validateShiftOverrides(patch.shiftSchedule.overrides)
      : ({ ok: true, overrides: undefined } as const);
  if (!overridesResult.ok) {
    return NextResponse.json({ ok: false, error: overridesResult.error }, { status: 400 });
  }

  const thresholdsValidation = validateThresholds(patch?.thresholds);
  if (!thresholdsValidation.ok) {
    return NextResponse.json({ ok: false, error: thresholdsValidation.error }, { status: 400 });
  }

  const defaultsValidation = validateDefaults(patch?.defaults);
  if (!defaultsValidation.ok) {
    return NextResponse.json({ ok: false, error: defaultsValidation.error }, { status: 400 });
  }

  if (patch?.shiftSchedule?.shifts !== undefined) {
    const shiftResult = validateShiftSchedule(patch.shiftSchedule.shifts);
    if (!shiftResult.ok) {
      return NextResponse.json({ ok: false, error: shiftResult.error }, { status: 400 });
    }
    patch = {
      ...patch,
      shiftSchedule: {
        ...patch.shiftSchedule,
        shifts: shiftResult.shifts?.map((s) => ({
          name: s.name,
          start: s.startTime,
          end: s.endTime,
          enabled: s.enabled !== false,
        })),
      },
    };
  }
  if (patch?.shiftSchedule) {
    patch = {
      ...patch,
      shiftSchedule: {
        ...patch.shiftSchedule,
        overrides:
          patch.shiftSchedule.overrides !== undefined
            ? overridesResult.overrides === null
              ? null
              : overridesResult.overrides
            : patch.shiftSchedule.overrides,
        shiftChangeCompensationMin:
          patch.shiftSchedule.shiftChangeCompensationMin !== undefined
            ? Number(patch.shiftSchedule.shiftChangeCompensationMin)
            : patch.shiftSchedule.shiftChangeCompensationMin,
        lunchBreakMin:
          patch.shiftSchedule.lunchBreakMin !== undefined
            ? Number(patch.shiftSchedule.lunchBreakMin)
            : patch.shiftSchedule.lunchBreakMin,
      },
    };
  }

  if (patch?.thresholds) {
    patch = {
      ...patch,
        thresholds: {
          ...patch.thresholds,
          stoppageMultiplier:
            patch.thresholds.stoppageMultiplier !== undefined
              ? Number(patch.thresholds.stoppageMultiplier)
              : patch.thresholds.stoppageMultiplier,
          macroStoppageMultiplier:
            patch.thresholds.macroStoppageMultiplier !== undefined
              ? Number(patch.thresholds.macroStoppageMultiplier)
              : patch.thresholds.macroStoppageMultiplier,
          oeeAlertThresholdPct:
            patch.thresholds.oeeAlertThresholdPct !== undefined
              ? Number(patch.thresholds.oeeAlertThresholdPct)
              : patch.thresholds.oeeAlertThresholdPct,
        performanceThresholdPct:
          patch.thresholds.performanceThresholdPct !== undefined
            ? Number(patch.thresholds.performanceThresholdPct)
            : patch.thresholds.performanceThresholdPct,
        qualitySpikeDeltaPct:
          patch.thresholds.qualitySpikeDeltaPct !== undefined
            ? Number(patch.thresholds.qualitySpikeDeltaPct)
            : patch.thresholds.qualitySpikeDeltaPct,
      },
    };
  }

  if (patch?.defaults) {
    patch = {
      ...patch,
      defaults: {
        ...patch.defaults,
        moldTotal:
          patch.defaults.moldTotal !== undefined ? Number(patch.defaults.moldTotal) : patch.defaults.moldTotal,
        moldActive:
          patch.defaults.moldActive !== undefined ? Number(patch.defaults.moldActive) : patch.defaults.moldActive,
      },
    };
  }

  const result = await prisma.$transaction(async (tx) => {
    const orgSettings = await ensureOrgSettings(tx, session.orgId, session.userId);
    if (!orgSettings?.settings) throw new Error("SETTINGS_NOT_FOUND");

    const existing = await tx.machineSettings.findUnique({
      where: { machineId },
      select: { overridesJson: true },
    });

    let nextOverrides: Record<string, unknown> | null = null;
    if (patch === null) {
      nextOverrides = null;
    } else {
      const merged = applyOverridePatch(existing?.overridesJson ?? {}, patch);
      nextOverrides = Object.keys(merged).length ? merged : null;
    }
    const nextOverridesJson =
      nextOverrides === null ? Prisma.DbNull : toJsonValue(nextOverrides);

    const saved = await tx.machineSettings.upsert({
      where: { machineId },
      update: {
        overridesJson: nextOverridesJson,
        updatedBy: session.userId,
      },
      create: {
        machineId,
        orgId: session.orgId,
        overridesJson: nextOverridesJson,
        updatedBy: session.userId,
      },
    });

    await tx.settingsAudit.create({
      data: {
        orgId: session.orgId,
        machineId,
        actorId: session.userId,
        source,
        payloadJson: body,
      },
    });

    return {
      orgSettingsRow: orgSettings.settings,
      shifts: orgSettings.shifts ?? [],
      overrides: pickAllowedOverrides(saved.overridesJson ?? {}),
      overridesUpdatedAt: saved.updatedAt,
    };
  });

  const baseOrg = buildSettingsPayload(result.orgSettingsRow, result.shifts) as Record<string, unknown>;
  const orgPayload = await attachReasonCatalog(
    session.orgId,
    result.orgSettingsRow.defaultsJson,
    result.orgSettingsRow.version,
    baseOrg
  );
  const effective = deepMerge(orgPayload, result.overrides) as Record<string, unknown>;

  const overridesUpdatedAt =
    result.overridesUpdatedAt && result.overridesUpdatedAt instanceof Date
      ? result.overridesUpdatedAt.toISOString()
      : undefined;
  try {
    await publishSettingsUpdate({
      orgId: session.orgId,
      machineId,
      version: Number(result.orgSettingsRow.version ?? 0),
      source,
      overridesUpdatedAt,
    });
  } catch (err) {
    console.warn("[settings machine PUT] MQTT publish failed", err);
  }

  return NextResponse.json({
    ok: true,
    machineId,
    orgSettings: orgPayload,
    effectiveSettings: effective,
    overrides: result.overrides,
  });
}
