import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/requireSession";
import { prisma } from "@/lib/prisma";



export async function GET() {
  try {
    const session = await requireSession();
    if (!session) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }
    const { userId, orgId } = session;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true, phone: true },
    });

    const org = await prisma.org.findUnique({
      where: { id: orgId },
      select: { id: true, name: true, slug: true },
    });

    const membership = await prisma.orgUser.findUnique({
      where: { orgId_userId: { orgId, userId } },
      select: { role: true },
    });

    return NextResponse.json({ ok: true, user, org, membership });
  } catch {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
}
