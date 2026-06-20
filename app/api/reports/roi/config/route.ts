import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOrgAdminSession } from "@/lib/auth/requireOrgAdminSession";

/**
 * ROI baseline config writer (admin/owner only). Stores the baseline window + target on
 * dedicated OrgSettings columns so the general settings save can't clobber them. The ROI
 * tracker reads these via lib/reports/roi. This is the UI-editable path (vs the SQL set-up).
 *
 *   PUT { baselineStart: ISO|null, baselineEnd: ISO|null, targetReductionPct: number }
 */

const bad = (status: number, error: string) => NextResponse.json({ ok: false, error }, { status });

function parseDateOrNull(v: unknown): Date | null | undefined {
  if (v === null) return null;
  if (typeof v !== "string" || !v.trim()) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

export async function PUT(req: Request) {
  const auth = await requireOrgAdminSession();
  if (!auth.ok) return auth.response;
  const { orgId } = auth.session;

  const body = await req.json().catch(() => null);
  if (!body) return bad(400, "Invalid payload");

  const baselineStart = parseDateOrNull(body.baselineStart);
  const baselineEnd = parseDateOrNull(body.baselineEnd);
  if (baselineStart === undefined && body.baselineStart !== undefined) return bad(400, "Invalid baselineStart");
  if (baselineEnd === undefined && body.baselineEnd !== undefined) return bad(400, "Invalid baselineEnd");
  if (baselineStart && baselineEnd && baselineStart >= baselineEnd) {
    return bad(400, "baselineStart must be before baselineEnd");
  }

  let targetReductionPct: number | undefined;
  if (body.targetReductionPct !== undefined && body.targetReductionPct !== null) {
    const n = Number(body.targetReductionPct);
    if (!Number.isFinite(n) || n < 0 || n > 100) return bad(400, "targetReductionPct must be 0–100");
    targetReductionPct = n;
  }

  const data = {
    roiBaselineStart: baselineStart === undefined ? undefined : baselineStart,
    roiBaselineEnd: baselineEnd === undefined ? undefined : baselineEnd,
    roiTargetReductionPct: targetReductionPct,
  };

  const saved = await prisma.orgSettings.upsert({
    where: { orgId },
    create: { orgId, ...data },
    update: data,
    select: { roiBaselineStart: true, roiBaselineEnd: true, roiTargetReductionPct: true },
  });

  return NextResponse.json({ ok: true, config: saved });
}
