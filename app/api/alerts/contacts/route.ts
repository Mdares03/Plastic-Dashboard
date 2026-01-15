import { NextResponse } from "next/server";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/requireSession";

const roleScopeSchema = z.preprocess(
  (value) => (typeof value === "string" ? value.trim().toUpperCase() : value),
  z.enum(["MEMBER", "ADMIN", "OWNER", "CUSTOM"])
);

const contactSchema = z.object({
  name: z.string().trim().min(1).max(120),
  roleScope: roleScopeSchema,
  email: z.string().trim().email().optional().nullable(),
  phone: z.string().trim().min(6).max(40).optional().nullable(),
  userId: z.string().uuid().optional().nullable(),
  eventTypes: z.array(z.string().trim().min(1)).optional().nullable(),
});

function canManageAlerts(role?: string | null) {
  return role === "OWNER";
}

export async function GET() {
  const session = await requireSession();
  if (!session) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const contacts = await prisma.alertContact.findMany({
    where: { orgId: session.orgId },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({ ok: true, contacts });
}

export async function POST(req: Request) {
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
  const parsed = contactSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid contact payload" }, { status: 400 });
  }

  const data = parsed.data;
  const hasChannel = !!(data.email || data.phone);
  if (!data.userId && !hasChannel) {
    return NextResponse.json({ ok: false, error: "email or phone required for external contact" }, { status: 400 });
  }

  const eventTypes =
    data.eventTypes === null ? Prisma.DbNull : data.eventTypes ?? undefined;

  const contact = await prisma.alertContact.create({
    data: {
      orgId: session.orgId,
      userId: data.userId ?? null,
      name: data.name,
      roleScope: data.roleScope,
      email: data.email ?? null,
      phone: data.phone ?? null,
      eventTypes,
    },
  });

  return NextResponse.json({ ok: true, contact });
}
