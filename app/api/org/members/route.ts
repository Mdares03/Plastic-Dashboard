import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/requireSession";
import { buildInviteEmail, sendEmail } from "@/lib/email";
import { getBaseUrl } from "@/lib/appUrl";
import { z } from "zod";

const INVITE_DAYS = 7;
const ROLES = new Set(["OWNER", "ADMIN", "MEMBER"]);
const inviteSchema = z.object({
  email: z.string().trim().min(1).max(254).email(),
  role: z.string().trim().toUpperCase().optional(),
});

function canManageMembers(role?: string | null) {
  return role === "OWNER" || role === "ADMIN";
}

export async function GET() {
  try {
    
    const session = await requireSession();
    if (!session) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const [org, members, invites] = await prisma.$transaction([
      prisma.org.findUnique({
        where: { id: session.orgId },
        select: { id: true, name: true, slug: true },
      }),
      prisma.orgUser.findMany({
        where: { orgId: session.orgId },
        orderBy: { createdAt: "asc" },
        include: {
          user: { select: { id: true, email: true, name: true, isActive: true, createdAt: true } },
        },
      }),
      prisma.orgInvite.findMany({
        where: {
          orgId: session.orgId,
          revokedAt: null,
          acceptedAt: null,
          expiresAt: { gt: new Date() },
        },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          email: true,
          role: true,
          token: true,
          createdAt: true,
          expiresAt: true,
        },
      }),
    ]);

    const mappedMembers = members.map((m) => ({
      id: m.user.id,
      membershipId: m.id,
      email: m.user.email,
      name: m.user.name,
      role: m.role,
      isActive: m.user.isActive,
      joinedAt: m.createdAt,
    }));

    return NextResponse.json({
      ok: true,
      org,
      members: mappedMembers,
      invites,
    });
  } catch {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireSession();
    if (!session) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
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

    const body = await req.json().catch(() => ({}));
    const parsed = inviteSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "Invalid invite payload" }, { status: 400 });
    }
    const email = parsed.data.email.toLowerCase();
    const role = String(parsed.data.role || "MEMBER").toUpperCase();

    if (!ROLES.has(role)) {
      return NextResponse.json({ ok: false, error: "Invalid role" }, { status: 400 });
    }

    const existingUser = await prisma.user.findUnique({ where: { email } });
    if (existingUser) {
      const existingMembership = await prisma.orgUser.findUnique({
        where: {
          orgId_userId: {
            orgId: session.orgId,
            userId: existingUser.id,
          },
        },
      });
      if (existingMembership) {
        return NextResponse.json({ ok: false, error: "User already in org" }, { status: 409 });
      }
    }

    const existingInvite = await prisma.orgInvite.findFirst({
      where: {
        orgId: session.orgId,
        email,
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
    });

    if (existingInvite) {
      return NextResponse.json({ ok: true, invite: existingInvite });
    }

    let invite = null;
    for (let i = 0; i < 3; i += 1) {
      const token = randomBytes(24).toString("hex");
      try {
        invite = await prisma.orgInvite.create({
          data: {
            orgId: session.orgId,
            email,
            role,
            token,
            invitedBy: session.userId,
            expiresAt: new Date(Date.now() + INVITE_DAYS * 24 * 60 * 60 * 1000),
          },
        });
        break;
      } catch (err: unknown) {
        const code = typeof err === "object" && err !== null ? (err as { code?: string }).code : undefined;
        if (code !== "P2002") throw err;
      }
    }

    if (!invite) {
      return NextResponse.json({ ok: false, error: "Failed to create invite" }, { status: 500 });
    }

    let emailSent = true;
    let emailError: string | null = null;
    try {
      const org = await prisma.org.findUnique({
        where: { id: session.orgId },
        select: { name: true },
      });
      const baseUrl = getBaseUrl(req);
      const inviteUrl = `${baseUrl}/invite/${invite.token}`;
      const appName = "MIS Control Tower";
      const content = buildInviteEmail({
        appName,
        orgName: org?.name || "your organization",
        inviteUrl,
      });
      await sendEmail({
        to: invite.email,
        subject: content.subject,
        text: content.text,
        html: content.html,
      });
    } catch (err: unknown) {
      emailSent = false;
      emailError = err instanceof Error ? err.message : "Failed to send invite email";
    }

    return NextResponse.json({ ok: true, invite, emailSent, emailError });
  } catch {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
}
