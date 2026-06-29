import { NextResponse } from "next/server";
import { requireOrgAdminSession } from "@/lib/auth/requireOrgAdminSession";
import { prisma } from "@/lib/prisma";
import { MAX_OPEN_EPISODE_MS } from "@/lib/metrics";

/**
 * Admin-only one-click fix for the `downtime_cap` health check. Caps any stored
 * downtime episode that exceeds the 12 h open-episode cap at the cap itself —
 * only making the stored value match the cap `computeDowntime` already applies
 * via Math.min(...), so totals/cost are consistent. No client payload; idempotent
 * (a second call caps 0).
 */
const MAX_OPEN_EPISODE_SECONDS = MAX_OPEN_EPISODE_MS / 1000;

export async function POST() {
  const auth = await requireOrgAdminSession();
  if (!auth.ok) return auth.response;
  const { orgId } = auth.session;

  const result = await prisma.reasonEntry.updateMany({
    where: { orgId, kind: "downtime", durationSeconds: { gt: MAX_OPEN_EPISODE_SECONDS } },
    data: { durationSeconds: MAX_OPEN_EPISODE_SECONDS },
  });

  return NextResponse.json({ ok: true, capped: result.count });
}
