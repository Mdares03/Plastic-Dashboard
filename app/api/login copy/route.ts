import { NextResponse } from "next/server";
import bcrypt from "bcrypt";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

const COOKIE_NAME = "mis_session";
const SESSION_DAYS = 7;

const loginSchema = z.object({
  email: z.string().trim().min(1).max(254).email(),
  password: z.string().min(1).max(256),
  next: z.string().optional(),
});

function safeNextPath(value: unknown) {
  const raw = String(value ?? "").trim();
  if (!raw) return "/machines";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/machines";
  return raw;
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid login payload" }, { status: 400 });
  }
  const email = parsed.data.email.toLowerCase();
  const password = parsed.data.password;
  const next = safeNextPath(parsed.data.next);

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
