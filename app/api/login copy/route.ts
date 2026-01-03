import { NextResponse } from "next/server";
import bcrypt from "bcrypt";
import { prisma } from "@/lib/prisma";

const COOKIE_NAME = "mis_session";
const SESSION_DAYS = 7;

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const next = String(body.next || "/machines");

  if (!email || !password) {
    return NextResponse.json({ ok: false, error: "Missing email/password" }, { status: 400 });
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.isActive) {
    return NextResponse.json({ ok: false, error: "Invalid credentials" }, { status: 401 });
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    return NextResponse.json({ ok: false, error: "Invalid credentials" }, { status: 401 });
  }

  // Multiple orgs per user: pick the oldest membership for now
  const membership = await prisma.orgUser.findFirst({
    where: { userId: user.id },
    orderBy: { createdAt: "asc" },
  });

  if (!membership) {
    return NextResponse.json({ ok: false, error: "User has no organization" }, { status: 403 });
  }

  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);

  const session = await prisma.session.create({
    data: {
      userId: user.id,
      orgId: membership.orgId,
      expiresAt,
      // optional fields you can add later: ip/userAgent
    },
  });

  const res = NextResponse.json({ ok: true, next });

  res.cookies.set(COOKIE_NAME, session.id, {
    httpOnly: true,
    sameSite: "lax",
    secure: false, // set true once HTTPS only
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });

  return res;
}
