import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/requireSession";
import { AlertPolicySchema, DEFAULT_POLICY } from "@/lib/alerts/policy";

function canManageAlerts(role?: string | null) {
  return role === "OWNER";
}

export async function GET() {
  const session = await requireSession();
  if (!session) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  let policy = await prisma.alertPolicy.findUnique({
    where: { orgId: session.orgId },
    select: { policyJson: true },
  });

  if (!policy) {
    await prisma.alertPolicy.create({
      data: { orgId: session.orgId, policyJson: DEFAULT_POLICY },
    });
    policy = { policyJson: DEFAULT_POLICY };
  }

  const parsed = AlertPolicySchema.safeParse(policy.policyJson);
  return NextResponse.json({ ok: true, policy: parsed.success ? parsed.data : DEFAULT_POLICY });
}

export async function PUT(req: Request) {
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
  const parsed = AlertPolicySchema.safeParse(body?.policy ?? body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid policy payload" }, { status: 400 });
  }

  await prisma.alertPolicy.upsert({
    where: { orgId: session.orgId },
    create: { orgId: session.orgId, policyJson: parsed.data, updatedBy: session.userId },
    update: { policyJson: parsed.data, updatedBy: session.userId },
  });

  return NextResponse.json({ ok: true });
}
