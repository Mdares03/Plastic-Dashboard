import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";

const COOKIE_NAME = "mis_session";

export async function requireSession() {
  const jar = await cookies();
  const sessionId = jar.get(COOKIE_NAME)?.value;
  if (!sessionId) return null;

  const session = await prisma.session.findFirst({
    where: {
      id: sessionId,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    include: {
      user: {
        select: { isActive: true, emailVerifiedAt: true },
      },
    },
  });

  if (!session) return null;

  if (!session.user?.isActive || !session.user?.emailVerifiedAt) {
    await prisma.session
      .update({ where: { id: session.id }, data: { revokedAt: new Date() } })
      .catch(() => {});
    return null;
  }

  // Optional: update lastSeenAt (useful later)
  await prisma.session
    .update({ where: { id: session.id }, data: { lastSeenAt: new Date() } })
    .catch(() => {});

  return {
    sessionId: session.id,
    userId: session.userId,
    orgId: session.orgId,
  };
}
