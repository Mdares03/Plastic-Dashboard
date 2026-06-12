import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { invalidateSessionCache } from "@/lib/auth/requireSession";

const COOKIE_NAME = "mis_session";

export async function POST() {
  const jar = await cookies();
  const sessionId = jar.get(COOKIE_NAME)?.value;

  if (sessionId) {
    await prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    }).catch(() => {});
    // Make revocation effective immediately in this process (TTL covers others).
    invalidateSessionCache(sessionId);
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE_NAME, "", { path: "/", maxAge: 0 });
  return res;
}
