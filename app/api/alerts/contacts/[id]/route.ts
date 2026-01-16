import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/requireSession";

const roleScopeSchema = z.preprocess(
  (value) => (typeof value === "string" ? value.trim().toUpperCase() : value),
  z.enum(["MEMBER", "ADMIN", "OWNER", "CUSTOM"])
);

const contactPatchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  roleScope: roleScopeSchema.optional(),
  email: z.string().trim().email().optional().nullable(),
  phone: z.string().trim().min(6).max(40).optional().nullable(),
  userId: z.string().uuid().optional().nullable(),
  eventTypes: z.array(z.string().trim().min(1)).optional().nullable(),
  isActive: z.boolean().optional(),
});

function canManageAlerts(role?: string | null) {
  return role === "OWNER";
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const membership = await prisma.orgUser.findUnique({
    where: { orgId_userId: { orgId: session.orgId, userId: session.userId } },
    select: { role: true },
  });
  if (!canManageAlerts(membership?.role)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = contactPatchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid contact payload" }, { status: 400 });
  }

  const { id } = await params;
  const existing = await prisma.alertContact.findFirst({
    where: { id, orgId: session.orgId },
  });
  if (!existing) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  const { userId: _userId, eventTypes, ...updateData } = parsed.data;
  void _userId;
  const normalizedEventTypes =
    eventTypes === null ? Prisma.DbNull : eventTypes ?? undefined;
  const data = normalizedEventTypes === undefined
    ? updateData
    : { ...updateData, eventTypes: normalizedEventTypes };
  const updated = await prisma.alertContact.update({
    where: { id },
    data,
  });

  return NextResponse.json({ ok: true, contact: updated });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const membership = await prisma.orgUser.findUnique({
    where: { orgId_userId: { orgId: session.orgId, userId: session.userId } },
    select: { role: true },
  });
  if (!canManageAlerts(membership?.role)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const existing = await prisma.alertContact.findFirst({
    where: { id, orgId: session.orgId },
  });
  if (!existing) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  await prisma.alertContact.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
