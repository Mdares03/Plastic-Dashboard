import { PrismaClient } from "@prisma/client";

// Revokes the session whose cookie was committed to the repo as cookies.txt
// (mis_session=b96c3e1d-191d-470c-b7ec-339799887bba, removed in the Phase 0
// hygiene commit). Dry-run by default; pass --apply to execute.
//
// Usage:
//   node scripts/security/revoke-leaked-session.mjs                # dry run
//   node scripts/security/revoke-leaked-session.mjs --apply        # revoke
//   node scripts/security/revoke-leaked-session.mjs --session-id <uuid>

const LEAKED_SESSION_ID = "b96c3e1d-191d-470c-b7ec-339799887bba";

const prisma = new PrismaClient();

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  if (i < 0) return null;
  const value = process.argv[i + 1];
  if (!value || value.startsWith("--")) return null;
  return value;
}

const apply = process.argv.includes("--apply");
const sessionId = argValue("--session-id") ?? LEAKED_SESSION_ID;

async function main() {
  const session = await prisma.session.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      orgId: true,
      userId: true,
      createdAt: true,
      lastSeenAt: true,
      expiresAt: true,
      revokedAt: true,
      user: { select: { email: true } },
    },
  });

  if (!session) {
    console.log(
      JSON.stringify({ dry_run: !apply, session_id: sessionId, found: false }, null, 2)
    );
    return;
  }

  const now = new Date();
  const status = session.revokedAt
    ? "already_revoked"
    : session.expiresAt < now
      ? "expired"
      : "ACTIVE";

  let action = "none";
  if (apply && !session.revokedAt) {
    await prisma.session.update({
      where: { id: sessionId },
      data: { revokedAt: now },
    });
    action = "revoked";
  } else if (!apply && !session.revokedAt) {
    action = "would_revoke (re-run with --apply)";
  }

  console.log(
    JSON.stringify(
      {
        dry_run: !apply,
        session_id: session.id,
        found: true,
        user_email: session.user?.email ?? null,
        org_id: session.orgId,
        created_at: session.createdAt.toISOString(),
        last_seen_at: session.lastSeenAt.toISOString(),
        expires_at: session.expiresAt.toISOString(),
        status_before: status,
        action,
      },
      null,
      2
    )
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
