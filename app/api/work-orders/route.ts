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
const MAX_TARGET_QTY = 2_000_000_000;
const MAX_CYCLE_TIME = 86_400;
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

    cleaned.push({
      workOrderId: idRaw,
      sku: sku ?? null,
      targetQty: targetQty ?? null,
      cycleTime: cycleTime ?? null,
    });
  }

  return cleaned;
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

  const created = await prisma.machineWorkOrder.createMany({
    data: cleaned.map((row) => ({
      orgId: session.orgId,
      machineId,
      workOrderId: row.workOrderId,
      sku: row.sku ?? null,
      targetQty: row.targetQty ?? null,
      cycleTime: row.cycleTime ?? null,
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
