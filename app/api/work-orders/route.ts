import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/requireSession";
import { publishWorkOrdersUpdate } from "@/lib/mqtt";
import { z } from "zod";

function canManage(role?: string | null) {
  return role === "OWNER" || role === "ADMIN";
}

const MAX_WORK_ORDERS = 2000;
const MAX_WORK_ORDER_ID_LENGTH = 64;
const MAX_SKU_LENGTH = 64;
const MAX_MOLD_LENGTH = 256;
const MAX_TARGET_QTY = 2_000_000_000;
const MAX_CYCLE_TIME = 86_400;
const MAX_CAVITIES = 100_000;
const WORK_ORDER_ID_RE = /^[A-Za-z0-9._-]+$/;

const uploadBodySchema = z.object({
  machineId: z.string().trim().min(1),
  workOrders: z.array(z.any()).optional(),
  orders: z.array(z.any()).optional(),
  workOrder: z.any().optional(),
});

function cleanText(value: unknown, maxLen: number) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text) return null;
  const sanitized = text.replace(/[\u0000-\u001f\u007f]/g, "");
  if (!sanitized) return null;
  return sanitized.length > maxLen ? sanitized.slice(0, maxLen) : sanitized;
}

function toIntOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function toFloatOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return n;
}

type WorkOrderInput = {
  workOrderId: string;
  sku?: string | null;
  targetQty?: number | null;
  cycleTime?: number | null;
  mold?: string | null;
  cavitiesTotal?: number | null;
  cavitiesActive?: number | null;
};

type RowIssue = {
  row: number;
  workOrderId: string | null;
  errors: string[];
};

function normalizeWorkOrders(raw: unknown[]) {
  const seen = new Set<string>();
  const cleaned: WorkOrderInput[] = [];

  for (const item of raw) {
    const record = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
    const idRaw = cleanText(
      record.workOrderId ?? record.id ?? record.work_order_id,
      MAX_WORK_ORDER_ID_LENGTH
    );
    if (!idRaw || !WORK_ORDER_ID_RE.test(idRaw) || seen.has(idRaw)) continue;
    seen.add(idRaw);

    const sku = cleanText(record.sku ?? record.SKU ?? null, MAX_SKU_LENGTH);
    const targetQtyRaw = toIntOrNull(
      record.targetQty ?? record.target_qty ?? record.target ?? record.targetQuantity
    );
    const cycleTimeRaw = toFloatOrNull(
      record.cycleTime ?? record.theoreticalCycleTime ?? record.theoretical_cycle_time ?? record.cycle_time
    );
    const targetQty =
      targetQtyRaw == null ? null : Math.min(Math.max(targetQtyRaw, 0), MAX_TARGET_QTY);
    const cycleTime =
      cycleTimeRaw == null ? null : Math.min(Math.max(cycleTimeRaw, 0), MAX_CYCLE_TIME);

    const mold = cleanText(
      record.mold ?? record.moldId ?? record.mold_id ?? null,
      MAX_MOLD_LENGTH
    );
    const cavitiesTotalRaw = toIntOrNull(
      record.cavitiesTotal ??
        record.cavities_total ??
        record.totalCavities ??
        record.total_cavities
    );
    const cavitiesActiveRaw = toIntOrNull(
      record.cavitiesActive ??
        record.cavities_active ??
        record.activeCavities ??
        record.active_cavities
    );
    const cavitiesTotal =
      cavitiesTotalRaw == null
        ? null
        : Math.min(Math.max(cavitiesTotalRaw, 0), MAX_CAVITIES);
    const cavitiesActive =
      cavitiesActiveRaw == null
        ? null
        : Math.min(Math.max(cavitiesActiveRaw, 0), MAX_CAVITIES);

    cleaned.push({
      workOrderId: idRaw,
      sku: sku ?? null,
      targetQty: targetQty ?? null,
      cycleTime: cycleTime ?? null,
      mold: mold ?? null,
      cavitiesTotal: cavitiesTotal ?? null,
      cavitiesActive: cavitiesActive ?? null,
    });
  }

  return cleaned;
}

// ✨ NUEVO: validación estricta del Excel
// Cada fila debe tener mold (no vacío), cavitiesTotal (>=1), cavitiesActive (>=1, <=cavitiesTotal)
// Si UNA SOLA fila falla, se rechaza el archivo completo (Opción A)
function validateRows(rows: WorkOrderInput[], rawList: unknown[]): RowIssue[] {
  const issues: RowIssue[] = [];

  // Validar lista cruda primero (si hay duplicados o IDs inválidos no llegaron a `cleaned`)
  // Pero aquí enfocamos en la validación de mold/cavidades sobre filas ya normalizadas.
  rows.forEach((row, idx) => {
    const errors: string[] = [];

    // Mold requerido
    if (!row.mold || row.mold.length === 0) {
      errors.push("Mold is required");
    }

    // Cavities Total requerido y >= 1
    if (row.cavitiesTotal == null) {
      errors.push("Total Cavities is required");
    } else if (row.cavitiesTotal < 1) {
      errors.push("Total Cavities must be at least 1");
    }

    // Cavities Active requerido y >= 1
    if (row.cavitiesActive == null) {
      errors.push("Active Cavities is required");
    } else if (row.cavitiesActive < 1) {
      errors.push("Active Cavities must be at least 1");
    }

    // Active <= Total
    if (
      row.cavitiesActive != null &&
      row.cavitiesTotal != null &&
      row.cavitiesActive > row.cavitiesTotal
    ) {
      errors.push(
        `Active Cavities (${row.cavitiesActive}) cannot exceed Total Cavities (${row.cavitiesTotal})`
      );
    }

    if (errors.length > 0) {
      issues.push({
        row: idx + 1, // 1-indexed para el operador
        workOrderId: row.workOrderId,
        errors,
      });
    }
  });

  return issues;
}

export async function POST(req: NextRequest) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const membership = await prisma.orgUser.findUnique({
    where: { orgId_userId: { orgId: session.orgId, userId: session.userId } },
    select: { role: true },
  });
  if (!canManage(membership?.role)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const parsedBody = uploadBodySchema.safeParse(body);
  if (!parsedBody.success) {
    return NextResponse.json({ ok: false, error: "Invalid payload" }, { status: 400 });
  }

  const machineId = String(parsedBody.data.machineId ?? "").trim();
  if (!machineId) {
    return NextResponse.json({ ok: false, error: "machineId is required" }, { status: 400 });
  }

  const machine = await prisma.machine.findFirst({
    where: { id: machineId, orgId: session.orgId },
    select: { id: true },
  });
  if (!machine) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

  const listRaw = Array.isArray(parsedBody.data.workOrders)
    ? parsedBody.data.workOrders
    : Array.isArray(parsedBody.data.orders)
      ? parsedBody.data.orders
      : parsedBody.data.workOrder
        ? [parsedBody.data.workOrder]
        : [];

  if (listRaw.length > MAX_WORK_ORDERS) {
    return NextResponse.json(
      { ok: false, error: `Too many work orders (max ${MAX_WORK_ORDERS})` },
      { status: 400 }
    );
  }

  const cleaned = normalizeWorkOrders(listRaw);
  if (!cleaned.length) {
    return NextResponse.json({ ok: false, error: "No valid work orders provided" }, { status: 400 });
  }

  // ✨ NUEVO: validación estricta de mold/cavidades
  // Si una sola fila falla, rechazamos el archivo completo
  const issues = validateRows(cleaned, listRaw);
  if (issues.length > 0) {
    return NextResponse.json(
      {
        ok: false,
        error: "Validation failed",
        summary: `Excel rejected: ${issues.length} of ${cleaned.length} work order(s) have errors. All work orders must include mold name, total cavities, and active cavities. Fix and re-upload.`,
        issues,
      },
      { status: 400 }
    );
  }

  const created = await prisma.machineWorkOrder.createMany({
    data: cleaned.map((row) => ({
      orgId: session.orgId,
      machineId,
      workOrderId: row.workOrderId,
      sku: row.sku ?? null,
      targetQty: row.targetQty ?? null,
      cycleTime: row.cycleTime ?? null,
      mold: row.mold ?? null,
      cavitiesTotal: row.cavitiesTotal ?? null,
      cavitiesActive: row.cavitiesActive ?? null,
      status: "PENDING",
    })),
    skipDuplicates: true,
  });

  try {
    await publishWorkOrdersUpdate({
      orgId: session.orgId,
      machineId,
      count: created.count,
    });
  } catch (err) {
    console.warn("[work orders POST] MQTT publish failed", err);
  }

  return NextResponse.json({
    ok: true,
    machineId,
    inserted: created.count,
    total: cleaned.length,
  });
}