import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/requireSession";
import {
  DEFAULT_ALERTS,
  DEFAULT_DEFAULTS,
  DEFAULT_SHIFT,
  buildSettingsPayload,
  normalizeAlerts,
  normalizeDefaults,
  stripUndefined,
  validateDefaults,
  validateShiftFields,
  validateShiftSchedule,
  validateThresholds,
} from "@/lib/settings";
import { publishSettingsUpdate } from "@/lib/mqtt";
import { z } from "zod";

function isPlainObject(value: any): value is Record<string, any> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function canManageSettings(role?: string | null) {
  return role === "OWNER" || role === "ADMIN";
}

const settingsPayloadSchema = z
  .object({
    source: z.string().trim().max(40).optional(),
    timezone: z.string().trim().max(64).optional(),
    shiftSchedule: z.any().optional(),
    thresholds: z.any().optional(),
    alerts: z.any().optional(),
    defaults: z.any().optional(),
    version: z.union([z.number(), z.string()]).optional(),
  })
  .passthrough();

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
      macroStoppageMultiplier: 5,
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

export async function GET() {
  const session = await requireSession();
  if (!session) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  try {
    const loaded = await prisma.$transaction(async (tx) => {
      const found = await ensureOrgSettings(tx, session.orgId, session.userId);
      if (!found?.settings) throw new Error("SETTINGS_NOT_FOUND");
      return found;
    });

    const payload = buildSettingsPayload(loaded.settings, loaded.shifts ?? []);
    return NextResponse.json({ ok: true, settings: payload });
  } catch (err) {
    console.error("[settings GET] failed", err);
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const membership = await prisma.orgUser.findUnique({
    where: { orgId_userId: { orgId: session.orgId, userId: session.userId } },
    select: { role: true },
  });
  if (!canManageSettings(membership?.role)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const parsed = settingsPayloadSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "Invalid settings payload" }, { status: 400 });
    }

    const source = String(parsed.data.source ?? "control_tower");
    const timezone = parsed.data.timezone;
    const shiftSchedule = parsed.data.shiftSchedule;
    const thresholds = parsed.data.thresholds;
    const alerts = parsed.data.alerts;
    const defaults = parsed.data.defaults;
    const expectedVersion = parsed.data.version;

    if (
      timezone === undefined &&
      shiftSchedule === undefined &&
      thresholds === undefined &&
      alerts === undefined &&
      defaults === undefined
    ) {
      return NextResponse.json({ ok: false, error: "No settings provided" }, { status: 400 });
    }

    if (shiftSchedule && !isPlainObject(shiftSchedule)) {
      return NextResponse.json({ ok: false, error: "shiftSchedule must be an object" }, { status: 400 });
    }
    if (thresholds !== undefined && !isPlainObject(thresholds)) {
      return NextResponse.json({ ok: false, error: "thresholds must be an object" }, { status: 400 });
    }
    if (alerts !== undefined && !isPlainObject(alerts)) {
      return NextResponse.json({ ok: false, error: "alerts must be an object" }, { status: 400 });
    }
    if (defaults !== undefined && !isPlainObject(defaults)) {
      return NextResponse.json({ ok: false, error: "defaults must be an object" }, { status: 400 });
    }

    const shiftValidation = validateShiftFields(
      shiftSchedule?.shiftChangeCompensationMin,
      shiftSchedule?.lunchBreakMin
    );
    if (!shiftValidation.ok) {
      return NextResponse.json({ ok: false, error: shiftValidation.error }, { status: 400 });
    }

    const thresholdsValidation = validateThresholds(thresholds);
    if (!thresholdsValidation.ok) {
      return NextResponse.json({ ok: false, error: thresholdsValidation.error }, { status: 400 });
    }

    const defaultsValidation = validateDefaults(defaults);
    if (!defaultsValidation.ok) {
      return NextResponse.json({ ok: false, error: defaultsValidation.error }, { status: 400 });
    }

    let shiftRows: any[] | null = null;
    if (shiftSchedule?.shifts !== undefined) {
      const shiftResult = validateShiftSchedule(shiftSchedule.shifts);
      if (!shiftResult.ok) {
        return NextResponse.json({ ok: false, error: shiftResult.error }, { status: 400 });
      }
      shiftRows = shiftResult.shifts ?? [];
    }
    const shiftRowsSafe = shiftRows ?? [];

    const updated = await prisma.$transaction(async (tx) => {
      const current = await ensureOrgSettings(tx, session.orgId, session.userId);
      if (!current?.settings) throw new Error("SETTINGS_NOT_FOUND");

    if (expectedVersion != null && Number(expectedVersion) !== Number(current.settings.version)) {
      return { error: "VERSION_MISMATCH", currentVersion: current.settings.version } as const;
    }

    const nextAlerts =
      alerts !== undefined ? { ...normalizeAlerts(current.settings.alertsJson), ...alerts } : undefined;
    const nextDefaults =
      defaults !== undefined ? { ...normalizeDefaults(current.settings.defaultsJson), ...defaults } : undefined;

    const updateData = stripUndefined({
      timezone: timezone !== undefined ? String(timezone) : undefined,
      shiftChangeCompMin:
        shiftSchedule?.shiftChangeCompensationMin !== undefined
          ? Number(shiftSchedule.shiftChangeCompensationMin)
          : undefined,
      lunchBreakMin:
        shiftSchedule?.lunchBreakMin !== undefined ? Number(shiftSchedule.lunchBreakMin) : undefined,
      stoppageMultiplier:
        thresholds?.stoppageMultiplier !== undefined ? Number(thresholds.stoppageMultiplier) : undefined,
      macroStoppageMultiplier:
        thresholds?.macroStoppageMultiplier !== undefined
          ? Number(thresholds.macroStoppageMultiplier)
          : undefined,
      oeeAlertThresholdPct:
        thresholds?.oeeAlertThresholdPct !== undefined ? Number(thresholds.oeeAlertThresholdPct) : undefined,
      performanceThresholdPct:
        thresholds?.performanceThresholdPct !== undefined
          ? Number(thresholds.performanceThresholdPct)
          : undefined,
      qualitySpikeDeltaPct:
        thresholds?.qualitySpikeDeltaPct !== undefined ? Number(thresholds.qualitySpikeDeltaPct) : undefined,
      alertsJson: nextAlerts,
      defaultsJson: nextDefaults,
    });

    const hasShiftUpdate = shiftRows !== null;
    const hasSettingsUpdate = Object.keys(updateData).length > 0;

    if (!hasShiftUpdate && !hasSettingsUpdate) {
      return { error: "No settings provided" } as const;
    }

    const updateWithMeta = {
      ...updateData,
      version: current.settings.version + 1,
      updatedBy: session.userId,
    };

    await tx.orgSettings.update({
      where: { orgId: session.orgId },
      data: updateWithMeta,
    });

    if (hasShiftUpdate) {
      await tx.orgShift.deleteMany({ where: { orgId: session.orgId } });
      if (shiftRowsSafe.length) {
        await tx.orgShift.createMany({
          data: shiftRowsSafe.map((s) => ({
            ...s,
            orgId: session.orgId,
          })),
        });
      }
    }

    const refreshed = await tx.orgSettings.findUnique({
      where: { orgId: session.orgId },
    });
    if (!refreshed) throw new Error("SETTINGS_NOT_FOUND");
    const refreshedShifts = await tx.orgShift.findMany({
      where: { orgId: session.orgId },
      orderBy: { sortOrder: "asc" },
    });

    await tx.settingsAudit.create({
      data: {
        orgId: session.orgId,
        actorId: session.userId,
        source,
        payloadJson: body,
      },
    });

      return { settings: refreshed, shifts: refreshedShifts };
    });

    if ((updated as any)?.error === "VERSION_MISMATCH") {
      return NextResponse.json(
        { ok: false, error: "Version mismatch", currentVersion: (updated as any).currentVersion },
        { status: 409 }
      );
    }

    if ((updated as any)?.error) {
      return NextResponse.json({ ok: false, error: (updated as any).error }, { status: 400 });
    }

    const payload = buildSettingsPayload(updated.settings, updated.shifts ?? []);
    const updatedAt =
      typeof payload.updatedAt === "string"
        ? payload.updatedAt
        : payload.updatedAt
        ? payload.updatedAt.toISOString()
        : undefined;
    try {
      await publishSettingsUpdate({
        orgId: session.orgId,
        version: Number(payload.version ?? 0),
        source,
        updatedAt,
      });
    } catch (err) {
      console.warn("[settings PUT] MQTT publish failed", err);
    }
    return NextResponse.json({ ok: true, settings: payload });
  } catch (err) {
    console.error("[settings PUT] failed", err);
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
