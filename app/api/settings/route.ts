import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createHash } from "crypto";
import { revalidateTag, unstable_cache } from "next/cache";
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
  validateShiftOverrides,
  validateThresholds,
} from "@/lib/settings";
import { effectiveReasonCatalogForOrg } from "@/lib/reasonCatalogDb";
import { publishSettingsUpdate } from "@/lib/mqtt";
import { z } from "zod";

type ValidShift = {
  name: string;
  startTime: string;
  endTime: string;
  sortOrder: number;
  enabled: boolean;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function canManageSettings(role?: string | null) {
  return role === "OWNER" || role === "ADMIN";
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

const settingsPayloadSchema = z
  .object({
    source: z.string().trim().max(40).optional(),
    modules: z.any().optional(),
    timezone: z.string().trim().max(64).optional(),
    shiftSchedule: z.any().optional(),
    thresholds: z.any().optional(),
    alerts: z.any().optional(),
    defaults: z.any().optional(),
    version: z.union([z.number(), z.string()]).optional(),
  })
  .passthrough();

const SETTINGS_TTL_SEC = 10;
const SETTINGS_SWR_SEC = 30;

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
      defaultsJson: { ...(DEFAULT_DEFAULTS as any), modules: { screenlessMode: false } },
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

async function loadSettingsPayload(orgId: string, userId: string) {
  const loaded = await prisma.$transaction(async (tx) => {
    const found = await ensureOrgSettings(tx, orgId, userId);
    if (!found?.settings) throw new Error("SETTINGS_NOT_FOUND");
    return found;
  });

  const base = buildSettingsPayload(loaded.settings, loaded.shifts ?? []) as Record<string, unknown>;
  const payload = await attachReasonCatalog(
    orgId,
    loaded.settings.defaultsJson,
    loaded.settings.version,
    base
  );
  const defaultsRaw = isPlainObject(loaded.settings.defaultsJson) ? (loaded.settings.defaultsJson as any) : {};
  const modulesRaw = isPlainObject(defaultsRaw.modules) ? defaultsRaw.modules : {};
  const modules = { screenlessMode: modulesRaw.screenlessMode === true };

  return { payload, modules };
}

async function loadSettingsCached(orgId: string, userId: string) {
  const cached = unstable_cache(
    () => loadSettingsPayload(orgId, userId),
    ["settings", orgId],
    { revalidate: SETTINGS_TTL_SEC, tags: [`settings:${orgId}`] }
  );
  return cached();
}

export async function GET(req: NextRequest) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  try {
    const url = new URL(req.url);
    const refresh = url.searchParams.get("refresh") === "1";
    const { payload, modules } = refresh
      ? await loadSettingsPayload(session.orgId, session.userId)
      : await loadSettingsCached(session.orgId, session.userId);

    const version = payload.version ?? 0;
    const etag = `W/"${createHash("sha1").update(`${session.orgId}:${version}`).digest("hex")}"`;
    const responseHeaders = new Headers({
      "Cache-Control": `private, max-age=${SETTINGS_TTL_SEC}, stale-while-revalidate=${SETTINGS_SWR_SEC}`,
      ETag: etag,
      Vary: "Cookie",
    });

    const ifNoneMatch = req.headers.get("if-none-match");
    if (!refresh && ifNoneMatch && ifNoneMatch === etag) {
      return new NextResponse(null, { status: 304, headers: responseHeaders });
    }

    return NextResponse.json({ ok: true, settings: { ...payload, modules } }, { headers: responseHeaders });

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
    const modules = parsed.data.modules;



    if (
      timezone === undefined &&
      shiftSchedule === undefined &&
      thresholds === undefined &&
      alerts === undefined &&
      defaults === undefined &&
      modules === undefined

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
    if (modules !== undefined && !isPlainObject(modules)) {
      return NextResponse.json({ ok: false, error: "Invalid modules payload" }, { status: 400 });
    }

    const screenlessMode =
      modules && typeof (modules as any).screenlessMode === "boolean"
        ? (modules as any).screenlessMode
        : undefined;



    const shiftValidation = validateShiftFields(
      shiftSchedule?.shiftChangeCompensationMin,
      shiftSchedule?.lunchBreakMin
    );
    if (!shiftValidation.ok) {
      return NextResponse.json({ ok: false, error: shiftValidation.error }, { status: 400 });
    }

    const overridesResult =
      shiftSchedule?.overrides !== undefined
        ? validateShiftOverrides(shiftSchedule.overrides)
        : ({ ok: true, overrides: undefined } as const);
    if (!overridesResult.ok) {
      return NextResponse.json({ ok: false, error: overridesResult.error }, { status: 400 });
    }

    const thresholdsValidation = validateThresholds(thresholds);
    if (!thresholdsValidation.ok) {
      return NextResponse.json({ ok: false, error: thresholdsValidation.error }, { status: 400 });
    }

    let shiftRows: ValidShift[] | null = null;
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
    const currentDefaultsRaw = isPlainObject(current.settings.defaultsJson)
      ? (current.settings.defaultsJson as any)
      : {};
    const currentModulesRaw = isPlainObject(currentDefaultsRaw.modules) ? currentDefaultsRaw.modules : {};

    // Merge defaults core (moldTotal, etc.)
    const nextDefaultsCore =
      defaults !== undefined ? { ...normalizeDefaults(currentDefaultsRaw), ...defaults } : undefined;

    // Validate merged defaults
    if (nextDefaultsCore) {
      const dv = validateDefaults(nextDefaultsCore);
      if (!dv.ok) return { error: dv.error } as const;
    }

    // Merge modules
    const nextModules =
      screenlessMode === undefined
        ? currentModulesRaw
        : { ...currentModulesRaw, screenlessMode };

    // Write defaultsJson if either defaults changed OR modules changed
    const shouldWriteDefaultsJson = !!nextDefaultsCore || screenlessMode !== undefined;

    const nextDefaultsJson = shouldWriteDefaultsJson
      ? { ...(nextDefaultsCore ?? normalizeDefaults(currentDefaultsRaw)), modules: nextModules }
      : undefined;

    if (nextDefaultsJson) {
      const defaultsTarget = nextDefaultsJson as Record<string, unknown>;
      delete defaultsTarget.reasonCatalog;
      delete defaultsTarget.reasonCatalogData;
    }


    const updateData = stripUndefined({
      timezone: timezone !== undefined ? String(timezone) : undefined,
      shiftChangeCompMin:
        shiftSchedule?.shiftChangeCompensationMin !== undefined
          ? Number(shiftSchedule.shiftChangeCompensationMin)
          : undefined,
      lunchBreakMin:
        shiftSchedule?.lunchBreakMin !== undefined ? Number(shiftSchedule.lunchBreakMin) : undefined,
      shiftScheduleOverridesJson:
        shiftSchedule?.overrides !== undefined
          ? overridesResult.overrides === null
            ? null
            : overridesResult.overrides
          : undefined,
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
      defaultsJson: nextDefaultsJson,
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

    if ("error" in updated && updated.error === "VERSION_MISMATCH") {
      return NextResponse.json(
        { ok: false, error: "Version mismatch", currentVersion: updated.currentVersion },
        { status: 409 }
      );
    }

    if ("error" in updated) {
      return NextResponse.json({ ok: false, error: updated.error }, { status: 400 });
    }

    const baseOut = buildSettingsPayload(updated.settings, updated.shifts ?? []) as Record<string, unknown>;
    const payload = await attachReasonCatalog(
      session.orgId,
      updated.settings.defaultsJson,
      updated.settings.version,
      baseOut
    );
    const updatedAt =
      typeof payload.updatedAt === "string"
        ? payload.updatedAt
        : payload.updatedAt
        ? (payload.updatedAt as Date).toISOString()
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
    const defaultsRaw = isPlainObject(updated.settings.defaultsJson) ? (updated.settings.defaultsJson as any) : {};
    const modulesRaw = isPlainObject(defaultsRaw.modules) ? defaultsRaw.modules : {};
    const modulesOut = { screenlessMode: modulesRaw.screenlessMode === true };

    revalidateTag(`settings:${session.orgId}`, { expire: 0 });

    return NextResponse.json({ ok: true, settings: { ...payload, modules: modulesOut } });

  } catch (err) {
    console.error("[settings PUT] failed", err);
    const message = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
