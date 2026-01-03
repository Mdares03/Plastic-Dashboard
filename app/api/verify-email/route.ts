import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { buildSessionCookieOptions, COOKIE_NAME, SESSION_DAYS } from "@/lib/auth/sessionCookie";
import { getBaseUrl } from "@/lib/appUrl";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  const wantsJson = req.headers.get("accept")?.includes("application/json");

  if (!token) {
    return NextResponse.json({ ok: false, error: "Missing token" }, { status: 400 });
  }

  const user = await prisma.user.findFirst({
    where: {
      emailVerificationToken: token,
      emailVerificationExpiresAt: { gt: new Date() },
    },
  });

  if (!user) {
    return NextResponse.json({ ok: false, error: "Invalid or expired token" }, { status: 404 });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      emailVerifiedAt: new Date(),
      emailVerificationToken: null,
      emailVerificationExpiresAt: null,
    },
  });

  const membership = await prisma.orgUser.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
  });

  if (!membership) {
    return NextResponse.json({ ok: false, error: "No organization found" }, { status: 403 });
  }

  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  const session = await prisma.session.create({
    data: {
      userId: user.id,
      orgId: membership.orgId,
      expiresAt,
    },
  });

  if (wantsJson) {
    const res = NextResponse.json({ ok: true, next: "/machines" });
    res.cookies.set(COOKIE_NAME, session.id, buildSessionCookieOptions(req));
    return res;
  }

  const res = NextResponse.redirect(new URL("/machines", getBaseUrl(req)));
  res.cookies.set(COOKIE_NAME, session.id, buildSessionCookieOptions(req));
  return res;
}
