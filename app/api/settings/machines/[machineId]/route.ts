import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/requireSession";
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
  validateThresholds,
} from "@/lib/settings";

function isPlainObject(value: any): value is Record<string, any> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function pickAllowedOverrides(raw: any) {
  if (!isPlainObject(raw)) return {};
  const out: Record<string, any> = {};
  for (const key of ["shiftSchedule", "thresholds", "alerts", "defaults"]) {
    if (raw[key] !== undefined) out[key] = raw[key];
  }
  return out;
}

async function ensureOrgSettings(tx: Prisma.TransactionClient, orgId: string, userId: string) {
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
      oeeAlertThresholdPct: 90,
      performanceThresholdPct: 85,
      qualitySpikeDeltaPct: 5,
      alertsJson: DEFAULT_ALERTS,
      defaultsJson: DEFAULT_DEFAULTS,
      updatedBy: userId,
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
  _req: NextRequest,
  { params }: { params: Promise<{ machineId: string }> }
) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { machineId } = await params;

  const machine = await prisma.machine.findFirst({
    where: { id: machineId, orgId: session.orgId },
    select: { id: true },
  });

  if (!machine) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

  const { settings, overrides } = await prisma.$transaction(async (tx) => {
    const orgSettings = await ensureOrgSettings(tx, session.orgId, session.userId);
    if (!orgSettings?.settings) throw new Error("SETTINGS_NOT_FOUND");

    const machineSettings = await tx.machineSettings.findUnique({
      where: { machineId },
      select: { overridesJson: true },
    });

    const orgPayload = buildSettingsPayload(orgSettings.settings, orgSettings.shifts ?? []);
    const rawOverrides = pickAllowedOverrides(machineSettings?.overridesJson ?? {});
    const effective = deepMerge(orgPayload, rawOverrides);

    return { settings: { org: orgPayload, effective }, overrides: rawOverrides };
  });

  return NextResponse.json({
    ok: true,
    machineId,
    orgSettings: settings.org,
    effectiveSettings: settings.effective,
    overrides,
  });
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ machineId: string }> }
) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const { machineId } = await params;

  const machine = await prisma.machine.findFirst({
    where: { id: machineId, orgId: session.orgId },
    select: { id: true },
  });

  if (!machine) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const source = String(body.source ?? "control_tower");

  let patch = body.overrides ?? body;
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

    let nextOverrides: any = null;
    if (patch === null) {
      nextOverrides = null;
    } else {
      const merged = applyOverridePatch(existing?.overridesJson ?? {}, patch);
      nextOverrides = Object.keys(merged).length ? merged : null;
    }

    const saved = await tx.machineSettings.upsert({
      where: { machineId },
      update: {
        overridesJson: nextOverrides,
        updatedBy: session.userId,
      },
      create: {
        machineId,
        orgId: session.orgId,
        overridesJson: nextOverrides,
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

    const orgPayload = buildSettingsPayload(orgSettings.settings, orgSettings.shifts ?? []);
    const overrides = pickAllowedOverrides(saved.overridesJson ?? {});
    const effective = deepMerge(orgPayload, overrides);

    return { orgPayload, overrides, effective };
  });

  return NextResponse.json({
    ok: true,
    machineId,
    orgSettings: result.orgPayload,
    effectiveSettings: result.effective,
    overrides: result.overrides,
  });
}
