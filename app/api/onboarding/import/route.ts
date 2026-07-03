import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireOrgAdminSession } from "@/lib/auth/requireOrgAdminSession";
import { onboardingConfigSchema } from "@/lib/onboarding/schema";
import { provisionOrg } from "@/lib/onboarding/provision";

/**
 * GET  — current org snapshot in the onboarding shape, so the wizard can
 *        pre-fill from what already exists (and a partial import can top it up).
 * POST — validate an uploaded/wizard payload against the ONE shared schema and
 *        provision it transactionally. Admin/owner only.
 */

export async function GET() {
  const auth = await requireOrgAdminSession();
  if (!auth.ok) return auth.response;
  const { orgId } = auth.session;

  const [org, settings, financial, machines, shifts, categories, contacts] = await Promise.all([
    prisma.org.findUnique({ where: { id: orgId }, select: { name: true } }),
    prisma.orgSettings.findUnique({
      where: { orgId },
      select: {
        timezone: true,
        stoppageMultiplier: true,
        macroStoppageMultiplier: true,
        oeeAlertThresholdPct: true,
        performanceThresholdPct: true,
        qualitySpikeDeltaPct: true,
      },
    }),
    prisma.orgFinancialProfile.findUnique({ where: { orgId } }),
    prisma.machine.findMany({
      where: { orgId },
      select: { name: true, code: true, location: true },
      orderBy: { name: "asc" },
    }),
    prisma.orgShift.findMany({ where: { orgId }, orderBy: { sortOrder: "asc" } }),
    prisma.reasonCatalogCategory.findMany({
      where: { orgId },
      include: { items: { orderBy: [{ sortOrder: "asc" }, { reasonCode: "asc" }] } },
      orderBy: [{ kind: "asc" }, { sortOrder: "asc" }],
    }),
    prisma.alertContact.findMany({
      where: { orgId, userId: null },
      select: { name: true, roleScope: true, email: true, phone: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const snapshot = {
    org: { name: org?.name ?? "", timezone: settings?.timezone ?? "UTC" },
    financial: financial
      ? {
          defaultCurrency: financial.defaultCurrency,
          machineCostPerMin: financial.machineCostPerMin ?? undefined,
          operatorCostPerMin: financial.operatorCostPerMin ?? undefined,
          ratedRunningKw: financial.ratedRunningKw ?? undefined,
          idleKw: financial.idleKw ?? undefined,
          kwhRate: financial.kwhRate ?? undefined,
          energyMultiplier: financial.energyMultiplier ?? undefined,
          scrapCostPerUnit: financial.scrapCostPerUnit ?? undefined,
          rawMaterialCostPerUnit: financial.rawMaterialCostPerUnit ?? undefined,
        }
      : undefined,
    machines: machines.map((m) => ({ name: m.name, code: m.code ?? "", location: m.location ?? "" })),
    shifts: shifts.map((s) => ({
      name: s.name,
      startTime: s.startTime,
      endTime: s.endTime,
      enabled: s.enabled,
    })),
    reasonCategories: categories.map((c) => ({
      kind: c.kind,
      name: c.name,
      codePrefix: c.codePrefix,
      planned: c.planned,
      items: c.items.map((it) => ({ name: it.name, codeSuffix: it.codeSuffix })),
    })),
    thresholds: settings
      ? {
          stoppageMultiplier: settings.stoppageMultiplier,
          macroStoppageMultiplier: settings.macroStoppageMultiplier,
          oeeAlertThresholdPct: settings.oeeAlertThresholdPct,
          performanceThresholdPct: settings.performanceThresholdPct,
          qualitySpikeDeltaPct: settings.qualitySpikeDeltaPct,
        }
      : undefined,
    alertContacts: contacts.map((c) => ({
      name: c.name,
      roleScope: c.roleScope,
      email: c.email ?? "",
      phone: c.phone ?? "",
    })),
  };

  return NextResponse.json({ ok: true, snapshot });
}

export async function POST(req: Request) {
  const auth = await requireOrgAdminSession();
  if (!auth.ok) return auth.response;
  const { orgId, userId } = auth.session;

  const body = await req.json().catch(() => null);
  if (body === null) {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = onboardingConfigSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid configuration", issues: parsed.error.issues },
      { status: 400 }
    );
  }

  try {
    const result = await provisionOrg(orgId, userId, parsed.data);
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: "Configuration conflicts", issues: result.errors }, { status: 400 });
    }

    // Invalidate the caches the changed config feeds.
    revalidateTag(`settings:${orgId}`, { expire: 0 });
    revalidateTag(`financial-config:${orgId}`, { expire: 0 });
    revalidateTag(`financial-impact:${orgId}`, { expire: 0 });

    // Surface each freshly-created machine's pairing code so the wizard can show
    // it before the 24h expiry (Task A — otherwise codes silently expire unseen).
    const pairing = result.createdMachines.map((m) => ({
      id: m.id,
      name: m.name,
      pairingCode: m.pairingCode,
      pairingCodeExpiresAt: m.pairingCodeExpiresAt.toISOString(),
    }));

    return NextResponse.json({ ok: true, counts: result.counts, pairing });
  } catch (err) {
    console.error("[onboarding import POST] failed", err);
    return NextResponse.json({ ok: false, error: "Provisioning failed" }, { status: 500 });
  }
}
