import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { logLine } from "@/lib/logger";

const COOKIE_NAME = "mis_session";
const SESSION_CACHE_TTL_MS = 30000;
const LAST_SEEN_TTL_MS = 300000;

type SessionPayload = {
  sessionId: string;
  userId: string;
  orgId: string;
};

type CachedSession = {
  value: SessionPayload;
  expiresAt: number;
};

const sessionCache = new Map<string, CachedSession>();
const lastSeenCache = new Map<string, number>();

function readCache(sessionId: string, now: number) {
  const cached = sessionCache.get(sessionId);
  if (!cached) return null;
  if (cached.expiresAt <= now) {
    sessionCache.delete(sessionId);
    return null;
  }
  return cached.value;
}

function writeCache(sessionId: string, value: SessionPayload, now: number) {
  sessionCache.set(sessionId, { value, expiresAt: now + SESSION_CACHE_TTL_MS });
}

function shouldUpdateLastSeen(sessionId: string, now: number) {
  const last = lastSeenCache.get(sessionId) ?? 0;
  if (now - last < LAST_SEEN_TTL_MS) return false;
  lastSeenCache.set(sessionId, now);
  return true;
}

export async function requireSession() {
  try {
    const jar = await cookies();
    const sessionId = jar.get(COOKIE_NAME)?.value;
    if (!sessionId) return null;

    const now = Date.now();
    const cached = readCache(sessionId, now);
    if (cached) return cached;

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
      void prisma.session
        .update({ where: { id: session.id }, data: { revokedAt: new Date() } })
        .catch(() => {});
      sessionCache.delete(sessionId);
      lastSeenCache.delete(sessionId);
      return null;
    }

    if (shouldUpdateLastSeen(sessionId, now)) {
      void prisma.session
        .update({ where: { id: session.id }, data: { lastSeenAt: new Date() } })
        .catch(() => {});
    }

    const payload = {
      sessionId: session.id,
      userId: session.userId,
      orgId: session.orgId,
    };
    writeCache(sessionId, payload, now);
    return payload;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    logLine("requireSession.error", { message, stack });
    console.error("[requireSession]", err);
    return null;
  }
}
