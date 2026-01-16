import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/requireSession";
import { Prisma } from "@prisma/client";
import { z } from "zod";

function canManageFinancials(role?: string | null) {
  return role === "OWNER";
}

function stripUndefined<T extends Record<string, unknown>>(input: T) {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) out[key] = value;
  }
  return out as T;
}

function normalizeCurrency(value?: string | null) {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.toUpperCase();
}

const numberField = z.preprocess(
  (value) => {
    if (value === "" || value === null || value === undefined) return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : value;
  },
  z.number().finite().nullable()
);

const numericFields = {
  machineCostPerMin: numberField.optional(),
  operatorCostPerMin: numberField.optional(),
  ratedRunningKw: numberField.optional(),
  idleKw: numberField.optional(),
  kwhRate: numberField.optional(),
  energyMultiplier: numberField.optional(),
  energyCostPerMin: numberField.optional(),
  scrapCostPerUnit: numberField.optional(),
  rawMaterialCostPerUnit: numberField.optional(),
};

const orgSchema = z
  .object({
    defaultCurrency: z.string().trim().min(1).max(8).optional(),
    ...numericFields,
  })
  .strict();

const locationSchema = z
  .object({
    location: z.string().trim().min(1).max(80),
    currency: z.string().trim().min(1).max(8).optional().nullable(),
    ...numericFields,
  })
  .strict();

const machineSchema = z
  .object({
    machineId: z.string().uuid(),
    currency: z.string().trim().min(1).max(8).optional().nullable(),
    ...numericFields,
  })
  .strict();

const productSchema = z
  .object({
    sku: z.string().trim().min(1).max(64),
    currency: z.string().trim().min(1).max(8).optional().nullable(),
    rawMaterialCostPerUnit: numberField.optional(),
  })
  .strict();

const payloadSchema = z
  .object({
    org: orgSchema.optional(),
    locations: z.array(locationSchema).optional(),
    machines: z.array(machineSchema).optional(),
    products: z.array(productSchema).optional(),
  })
  .strict();

async function ensureOrgFinancialProfile(
  tx: Prisma.TransactionClient,
  orgId: string,
  userId: string
) {
  const existing = await tx.orgFinancialProfile.findUnique({ where: { orgId } });
  if (existing) return existing;
  return tx.orgFinancialProfile.create({
    data: {
      orgId,
      defaultCurrency: "USD",
      energyMultiplier: 1.0,
      updatedBy: userId,
    },
  });
}

async function loadFinancialConfig(orgId: string) {
  const [org, locations, machines, products] = await Promise.all([
    prisma.orgFinancialProfile.findUnique({ where: { orgId } }),
    prisma.locationFinancialOverride.findMany({ where: { orgId }, orderBy: { location: "asc" } }),
    prisma.machineFinancialOverride.findMany({ where: { orgId }, orderBy: { createdAt: "desc" } }),
    prisma.productCostOverride.findMany({ where: { orgId }, orderBy: { sku: "asc" } }),
  ]);

  return { org, locations, machines, products };
}

export async function GET() {
  const session = await requireSession();
  if (!session) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const membership = await prisma.orgUser.findUnique({
    where: { orgId_userId: { orgId: session.orgId, userId: session.userId } },
    select: { role: true },
  });
  if (!canManageFinancials(membership?.role)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  await prisma.$transaction((tx) => ensureOrgFinancialProfile(tx, session.orgId, session.userId));
  const payload = await loadFinancialConfig(session.orgId);
  return NextResponse.json({ ok: true, ...payload });
}

export async function POST(req: Request) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const membership = await prisma.orgUser.findUnique({
    where: { orgId_userId: { orgId: session.orgId, userId: session.userId } },
    select: { role: true },
  });
  if (!canManageFinancials(membership?.role)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = payloadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
  }

  const data = parsed.data;

  await prisma.$transaction(async (tx) => {
    await ensureOrgFinancialProfile(tx, session.orgId, session.userId);

    if (data.org) {
      const updateData = stripUndefined({
        defaultCurrency: data.org.defaultCurrency?.trim().toUpperCase(),
        machineCostPerMin: data.org.machineCostPerMin,
        operatorCostPerMin: data.org.operatorCostPerMin,
        ratedRunningKw: data.org.ratedRunningKw,
        idleKw: data.org.idleKw,
        kwhRate: data.org.kwhRate,
        energyMultiplier: data.org.energyMultiplier == null ? undefined : data.org.energyMultiplier,
        energyCostPerMin: data.org.energyCostPerMin,
        scrapCostPerUnit: data.org.scrapCostPerUnit,
        rawMaterialCostPerUnit: data.org.rawMaterialCostPerUnit,
        updatedBy: session.userId,
      });

      if (Object.keys(updateData).length > 0) {
        await tx.orgFinancialProfile.update({
          where: { orgId: session.orgId },
          data: updateData,
        });
      }
    }

    const machineIds = new Set((data.machines ?? []).map((m) => m.machineId));
    const validMachineIds = new Set<string>();
    if (machineIds.size > 0) {
      const rows = await tx.machine.findMany({
        where: { orgId: session.orgId, id: { in: Array.from(machineIds) } },
        select: { id: true },
      });
      rows.forEach((m) => validMachineIds.add(m.id));
    }

    for (const loc of data.locations ?? []) {
      const updateData = stripUndefined({
        currency: normalizeCurrency(loc.currency),
        machineCostPerMin: loc.machineCostPerMin,
        operatorCostPerMin: loc.operatorCostPerMin,
        ratedRunningKw: loc.ratedRunningKw,
        idleKw: loc.idleKw,
        kwhRate: loc.kwhRate,
        energyMultiplier: loc.energyMultiplier,
        energyCostPerMin: loc.energyCostPerMin,
        scrapCostPerUnit: loc.scrapCostPerUnit,
        rawMaterialCostPerUnit: loc.rawMaterialCostPerUnit,
        updatedBy: session.userId,
      });

      await tx.locationFinancialOverride.upsert({
        where: { orgId_location: { orgId: session.orgId, location: loc.location } },
        update: updateData,
        create: {
          orgId: session.orgId,
          location: loc.location,
          ...updateData,
        },
      });
    }

    for (const machine of data.machines ?? []) {
      if (!validMachineIds.has(machine.machineId)) continue;
      const updateData = stripUndefined({
        currency: normalizeCurrency(machine.currency),
        machineCostPerMin: machine.machineCostPerMin,
        operatorCostPerMin: machine.operatorCostPerMin,
        ratedRunningKw: machine.ratedRunningKw,
        idleKw: machine.idleKw,
        kwhRate: machine.kwhRate,
        energyMultiplier: machine.energyMultiplier,
        energyCostPerMin: machine.energyCostPerMin,
        scrapCostPerUnit: machine.scrapCostPerUnit,
        rawMaterialCostPerUnit: machine.rawMaterialCostPerUnit,
        updatedBy: session.userId,
      });

      await tx.machineFinancialOverride.upsert({
        where: { orgId_machineId: { orgId: session.orgId, machineId: machine.machineId } },
        update: updateData,
        create: {
          orgId: session.orgId,
          machineId: machine.machineId,
          ...updateData,
        },
      });
    }

    for (const product of data.products ?? []) {
      const updateData = stripUndefined({
        currency: normalizeCurrency(product.currency),
        rawMaterialCostPerUnit: product.rawMaterialCostPerUnit,
        updatedBy: session.userId,
      });

      await tx.productCostOverride.upsert({
        where: { orgId_sku: { orgId: session.orgId, sku: product.sku } },
        update: updateData,
        create: {
          orgId: session.orgId,
          sku: product.sku,
          ...updateData,
        },
      });
    }
  });

  const payload = await loadFinancialConfig(session.orgId);
  return NextResponse.json({ ok: true, ...payload });
}
