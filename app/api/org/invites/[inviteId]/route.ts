import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/requireSession";
import { z } from "zod";

function canManageMembers(role?: string | null) {
  return role === "OWNER" || role === "ADMIN";
}

const inviteIdSchema = z.string().uuid();

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ inviteId: string }> }
) {
  try {
    const session = await requireSession();
    if (!session) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const { inviteId } = await params;
    if (!inviteIdSchema.safeParse(inviteId).success) {
      return NextResponse.json({ ok: false, error: "Invalid invite id" }, { status: 400 });
    }

    const membership = await prisma.orgUser.findUnique({
      where: {
        orgId_userId: {
          orgId: session.orgId,
          userId: session.userId,
        },
      },
      select: { role: true },
    });

    if (!canManageMembers(membership?.role)) {
      return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    }

    await prisma.orgInvite.updateMany({
      where: {
        id: inviteId,
        orgId: session.orgId,
        acceptedAt: null,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
}
