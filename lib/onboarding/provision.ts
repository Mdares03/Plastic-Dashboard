import { randomBytes } from "crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { generatePairingCode } from "@/lib/pairingCode";
import { DEFAULT_ALERTS, DEFAULT_DEFAULTS } from "@/lib/settings";
import { buildProvisionPlan, type ProvisionCounts, type ProvisionPlanError } from "@/lib/onboarding/plan";
import type { OnboardingConfig } from "@/lib/onboarding/schema";

/**
 * Applies a validated OnboardingConfig to ONE org in a single transaction,
 * reusing the same tables the Settings pages write (machines, financial
 * profile, shifts, reason catalog, thresholds, alert contacts). Idempotent:
 * everything upserts on its natural key, so re-importing a corrected template
 * updates rather than duplicates. Either every section lands or none does.
 */

export type ProvisionResult =
  | { ok: true; counts: ProvisionCounts }
  | { ok: false; errors: ProvisionPlanError[] };

async function ensureOrgSettings(tx: Prisma.TransactionClient, orgId: string, userId: string) {
  const existing = await tx.orgSettings.findUnique({ where: { orgId } });
  if (existing) return existing;
  return tx.orgSettings.create({
    data: {
      orgId,
      timezone: "UTC",
      alertsJson: DEFAULT_ALERTS,
      defaultsJson: { ...(DEFAULT_DEFAULTS as Record<string, unknown>), modules: { screenlessMode: false } },
      updatedBy: userId,
    },
  });
}

async function ensureFinancialProfile(tx: Prisma.TransactionClient, orgId: string, userId: string) {
  const existing = await tx.orgFinancialProfile.findUnique({ where: { orgId } });
  if (existing) return existing;
  return tx.orgFinancialProfile.create({
    data: { orgId, defaultCurrency: "USD", energyMultiplier: 1.0, updatedBy: userId },
  });
}

/** Generate a pairing code that isn't already taken (checked inside the tx so a
 *  collision never aborts the whole import). */
async function freshPairingCode(tx: Prisma.TransactionClient): Promise<string> {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = generatePairingCode();
    const clash = await tx.machine.findUnique({ where: { pairingCode: code }, select: { id: true } });
    if (!clash) return code;
  }
  // Astronomically unlikely; fall back to a longer code.
  return generatePairingCode(12);
}

export async function provisionOrg(
  orgId: string,
  userId: string,
  config: OnboardingConfig
): Promise<ProvisionResult> {
  const { plan, errors, counts } = buildProvisionPlan(config);
  if (errors.length > 0) return { ok: false, errors };

  await prisma.$transaction(async (tx) => {
    // Org name
    if (plan.org?.name) {
      await tx.org.update({ where: { id: orgId }, data: { name: plan.org.name } });
    }

    // Org settings (timezone + thresholds). Ensure a row exists either way so
    // shifts/reason-catalog version bumps have something to update.
    await ensureOrgSettings(tx, orgId, userId);
    const settingsUpdate: Prisma.OrgSettingsUpdateInput = {};
    if (plan.org?.timezone) settingsUpdate.timezone = plan.org.timezone;
    if (plan.thresholds) {
      const t = plan.thresholds;
      if (t.stoppageMultiplier !== undefined) settingsUpdate.stoppageMultiplier = t.stoppageMultiplier;
      if (t.macroStoppageMultiplier !== undefined) settingsUpdate.macroStoppageMultiplier = t.macroStoppageMultiplier;
      if (t.oeeAlertThresholdPct !== undefined) settingsUpdate.oeeAlertThresholdPct = t.oeeAlertThresholdPct;
      if (t.performanceThresholdPct !== undefined) settingsUpdate.performanceThresholdPct = t.performanceThresholdPct;
      if (t.qualitySpikeDeltaPct !== undefined) settingsUpdate.qualitySpikeDeltaPct = t.qualitySpikeDeltaPct;
    }
    if (Object.keys(settingsUpdate).length > 0) {
      settingsUpdate.updatedBy = userId;
      await tx.orgSettings.update({ where: { orgId }, data: settingsUpdate });
    }

    // Financial profile
    if (plan.financial) {
      await ensureFinancialProfile(tx, orgId, userId);
      const f = plan.financial;
      const data: Prisma.OrgFinancialProfileUpdateInput = { updatedBy: userId };
      if (f.defaultCurrency !== undefined) data.defaultCurrency = f.defaultCurrency.trim().toUpperCase();
      if (f.machineCostPerMin !== undefined) data.machineCostPerMin = f.machineCostPerMin;
      if (f.operatorCostPerMin !== undefined) data.operatorCostPerMin = f.operatorCostPerMin;
      if (f.ratedRunningKw !== undefined) data.ratedRunningKw = f.ratedRunningKw;
      if (f.idleKw !== undefined) data.idleKw = f.idleKw;
      if (f.kwhRate !== undefined) data.kwhRate = f.kwhRate;
      if (f.energyMultiplier !== undefined) data.energyMultiplier = f.energyMultiplier;
      if (f.scrapCostPerUnit !== undefined) data.scrapCostPerUnit = f.scrapCostPerUnit;
      if (f.rawMaterialCostPerUnit !== undefined) data.rawMaterialCostPerUnit = f.rawMaterialCostPerUnit;
      await tx.orgFinancialProfile.update({ where: { orgId }, data });
    }

    // Machines — upsert by (orgId, name). New machines get an apiKey + pairing
    // code so the edge can pair them; existing machines only refresh code/location.
    for (const m of plan.machines) {
      const existing = await tx.machine.findFirst({
        where: { orgId, name: m.name },
        select: { id: true },
      });
      if (existing) {
        await tx.machine.update({
          where: { id: existing.id },
          data: { code: m.code, location: m.location },
        });
      } else {
        await tx.machine.create({
          data: {
            orgId,
            name: m.name,
            code: m.code,
            location: m.location,
            apiKey: randomBytes(24).toString("hex"),
            pairingCode: await freshPairingCode(tx),
            pairingCodeExpiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
          },
        });
      }
    }

    // Shifts — full replace (mirrors Settings → Shifts) only when provided.
    if (plan.shifts.length > 0) {
      await tx.orgShift.deleteMany({ where: { orgId } });
      await tx.orgShift.createMany({
        data: plan.shifts.map((s) => ({
          orgId,
          name: s.name,
          startTime: s.startTime,
          endTime: s.endTime,
          sortOrder: s.sortOrder,
          enabled: s.enabled,
        })),
      });
    }

    // Reason catalog — upsert categories by (orgId, kind, name) and items by
    // (orgId, reasonCode), the catalog's natural keys.
    let catalogTouched = false;
    for (const cat of plan.reasonCategories) {
      catalogTouched = true;
      const existingCat = await tx.reasonCatalogCategory.findFirst({
        where: { orgId, kind: cat.kind, name: cat.name },
        select: { id: true },
      });
      const categoryId = existingCat
        ? (
            await tx.reasonCatalogCategory.update({
              where: { id: existingCat.id },
              data: { codePrefix: cat.codePrefix, planned: cat.planned, sortOrder: cat.sortOrder, active: true },
              select: { id: true },
            })
          ).id
        : (
            await tx.reasonCatalogCategory.create({
              data: {
                orgId,
                kind: cat.kind,
                name: cat.name,
                codePrefix: cat.codePrefix,
                planned: cat.planned,
                sortOrder: cat.sortOrder,
                active: true,
              },
              select: { id: true },
            })
          ).id;

      for (const item of cat.items) {
        const existingItem = await tx.reasonCatalogItem.findFirst({
          where: { orgId, reasonCode: item.reasonCode },
          select: { id: true },
        });
        if (existingItem) {
          await tx.reasonCatalogItem.update({
            where: { id: existingItem.id },
            data: { categoryId, name: item.name, codeSuffix: item.codeSuffix, sortOrder: item.sortOrder, active: true },
          });
        } else {
          await tx.reasonCatalogItem.create({
            data: {
              orgId,
              categoryId,
              name: item.name,
              codeSuffix: item.codeSuffix,
              reasonCode: item.reasonCode,
              sortOrder: item.sortOrder,
              active: true,
            },
          });
        }
      }
    }
    if (catalogTouched) {
      await tx.orgSettings.update({
        where: { orgId },
        data: { version: { increment: 1 }, updatedBy: userId },
      });
    }

    // Alert contacts — upsert by (orgId, name) for contacts not tied to a user.
    for (const c of plan.alertContacts) {
      const existing = await tx.alertContact.findFirst({
        where: { orgId, name: c.name, userId: null },
        select: { id: true },
      });
      if (existing) {
        await tx.alertContact.update({
          where: { id: existing.id },
          data: { roleScope: c.roleScope, email: c.email, phone: c.phone, isActive: true },
        });
      } else {
        await tx.alertContact.create({
          data: { orgId, name: c.name, roleScope: c.roleScope, email: c.email, phone: c.phone, isActive: true },
        });
      }
    }

    // Audit trail for the bulk write.
    await tx.settingsAudit.create({
      data: { orgId, actorId: userId, source: "onboarding_import", payloadJson: config as Prisma.InputJsonValue },
    });
  });

  return { ok: true, counts };
}
