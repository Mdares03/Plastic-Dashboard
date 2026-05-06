import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/requireSession";

export type OrgAdminSession = { orgId: string; userId: string };

export async function requireOrgAdminSession(): Promise<
  { ok: true; session: OrgAdminSession } | { ok: false; response: NextResponse }
> {
  const session = await requireSession();
  if (!session) {
    return {
      ok: false,
      response: NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 }),
    };
  }
  const membership = await prisma.orgUser.findUnique({
    where: { orgId_userId: { orgId: session.orgId, userId: session.userId } },
    select: { role: true },
  });
  if (membership?.role !== "OWNER" && membership?.role !== "ADMIN") {
    return { ok: false, response: NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 }) };
  }
  return { ok: true, session: { orgId: session.orgId, userId: session.userId } };
}
