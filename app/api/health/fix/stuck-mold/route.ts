import { NextResponse } from "next/server";
import { requireOrgAdminSession } from "@/lib/auth/requireOrgAdminSession";
import { prisma } from "@/lib/prisma";
import { MAX_OPEN_EPISODE_MS } from "@/lib/metrics";

/**
 * Admin-only one-click fix for the `stuck_mold` health check. Re-derives the
 * stuck mold-change incidents server-side (the SAME logic runConsistencyChecks
 * reads — active + unresolved + open > 12 h, grouped by incidentKey) and writes a
 * synthetic resolved mold-change row for each. The client never sends IDs, so the
 * action is trustworthy and idempotent: a second call resolves 0.
 */
const MOLD_ACTIVE_STALE_MS = MAX_OPEN_EPISODE_MS;

export async function POST() {
  const auth = await requireOrgAdminSession();
  if (!auth.ok) return auth.response;
  const { orgId } = auth.session;

  // Re-derive the stuck incidents exactly as the check does.
  const moldEvents = await prisma.machineEvent.findMany({
    where: { orgId, eventType: "mold-change" },
    select: { machineId: true, ts: true, data: true },
  });
  const byIncident = new Map<
    string,
    { machineId: string; active: boolean; resolved: boolean; startMs: number }
  >();
  const now = Date.now();
  for (const e of moldEvents) {
    const d = (e.data ?? {}) as Record<string, unknown>;
    const ik = (d.incidentKey as string) ?? `${e.machineId}:${e.ts.getTime()}`;
    const entry =
      byIncident.get(ik) ??
      { machineId: e.machineId, active: false, resolved: false, startMs: e.ts.getTime() };
    if (d.status === "active") {
      entry.active = true;
      entry.startMs = Number(d.start_ms) || e.ts.getTime();
    }
    if (d.status === "resolved") entry.resolved = true;
    byIncident.set(ik, entry);
  }

  const stuck = [...byIncident.entries()].filter(
    ([, v]) => v.active && !v.resolved && now - v.startMs > MOLD_ACTIVE_STALE_MS,
  );

  // Write a synthetic resolved mold-change row per stuck incident, carrying the
  // same incidentKey so the check's resolve logic (d.status === "resolved") picks
  // it up. Shape mirrors the edge-emitted mold-change rows.
  const tsNow = new Date();
  for (const [incidentKey, v] of stuck) {
    await prisma.machineEvent.create({
      data: {
        orgId,
        machineId: v.machineId,
        ts: tsNow,
        topic: "mold-change",
        eventType: "mold-change",
        severity: "info",
        requiresAck: false,
        title: "Mold change resolved",
        description: "Marked finished from the reliability panel.",
        data: {
          incidentKey,
          status: "resolved",
          source: "manual-resolve",
          start_ms: v.startMs,
          end_ms: tsNow.getTime(),
        },
      },
    });
  }

  return NextResponse.json({ ok: true, resolved: stuck.length });
}
