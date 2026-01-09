import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import bcrypt from "bcrypt";
import { prisma } from "@/lib/prisma";
import { buildSessionCookieOptions, COOKIE_NAME, SESSION_DAYS } from "@/lib/auth/sessionCookie";
import { z } from "zod";

const tokenSchema = z.string().regex(/^[a-f0-9]{48}$/i);
const acceptSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  password: z.string().min(8).max(256),
});

async function loadInvite(token: string) {
  return prisma.orgInvite.findFirst({
    where: {
      token,
      revokedAt: null,
      acceptedAt: null,
      expiresAt: { gt: new Date() },
    },
    include: {
      org: { select: { id: true, name: true, slug: true } },
    },
  });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  if (!tokenSchema.safeParse(token).success) {
    return NextResponse.json({ ok: false, error: "Invalid invite token" }, { status: 400 });
  }
  const invite = await loadInvite(token);
  if (!invite) {
    return NextResponse.json({ ok: false, error: "Invite not found" }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    invite: {
      email: invite.email,
      role: invite.role,
      org: invite.org,
      expiresAt: invite.expiresAt,
    },
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  if (!tokenSchema.safeParse(token).success) {
    return NextResponse.json({ ok: false, error: "Invalid invite token" }, { status: 400 });
  }
  const invite = await loadInvite(token);
  if (!invite) {
    return NextResponse.json({ ok: false, error: "Invite not found" }, { status: 404 });
  }

  const body = await req.json().catch(() => ({}));
  const parsed = acceptSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid invite payload" }, { status: 400 });
  }
  const name = String(parsed.data.name || "").trim();
  const password = parsed.data.password;

  const existingUser = await prisma.user.findUnique({
    where: { email: invite.email },
  });

  if (!existingUser && !name) {
    return NextResponse.json({ ok: false, error: "Name is required" }, { status: 400 });
  }

  let userId = existingUser?.id ?? null;
  if (existingUser) {
    if (!existingUser.isActive) {
      return NextResponse.json({ ok: false, error: "User is inactive" }, { status: 403 });
    }
    const ok = await bcrypt.compare(password, existingUser.passwordHash);
    if (!ok) {
      return NextResponse.json({ ok: false, error: "Invalid credentials" }, { status: 401 });
    }
    userId = existingUser.id;
  } else {
    const passwordHash = await bcrypt.hash(password, 10);
    const created = await prisma.user.create({
      data: {
        email: invite.email,
        name,
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });
    userId = created.id;
  }

  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);

  const session = await prisma.$transaction(async (tx) => {
    if (existingUser && !existingUser.emailVerifiedAt) {
      await tx.user.update({
        where: { id: existingUser.id },
        data: {
          emailVerifiedAt: new Date(),
          emailVerificationToken: null,
          emailVerificationExpiresAt: null,
        },
      });
    }

    await tx.orgUser.upsert({
      where: {
        orgId_userId: {
          orgId: invite.orgId,
          userId,
        },
      },
      update: {
        role: invite.role,
      },
      create: {
        orgId: invite.orgId,
        userId,
        role: invite.role,
      },
    });

    await tx.orgInvite.update({
      where: { id: invite.id },
      data: { acceptedAt: new Date() },
    });

    return tx.session.create({
      data: {
        userId,
        orgId: invite.orgId,
        expiresAt,
      },
    });
  });

  const res = NextResponse.json({ ok: true, next: "/machines" });
  res.cookies.set(COOKIE_NAME, session.id, buildSessionCookieOptions(req));

  return res;
}
