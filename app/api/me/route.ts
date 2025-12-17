import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/requireSession";
import { prisma } from "@/lib/prisma";

export async function GET() {
  try {
    const { userId, orgId } = await requireSession();

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, name: true },
    });

    const org = await prisma.org.findUnique({
      where: { id: orgId },
      select: { id: true, name: true, slug: true },
    });

    return NextResponse.json({ ok: true, user, org });
  } catch {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
}
