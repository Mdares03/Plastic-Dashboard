import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getBaseUrl } from "@/lib/appUrl";
import { buildRoiSummaryEmail, sendEmail } from "@/lib/email";
import { computeRoi } from "@/lib/reports/roi";

/**
 * C5 — weekly/monthly ROI summary email. Cron-only, secret-gated (fail-closed, same model as
 * the downtime-action reminders): it fans out across every org, so there is no safe logged-in
 * caller. Schedule it (cron/systemd) to POST here weekly or monthly.
 *
 *   POST /api/reports/roi/email?token=<ROI_SUMMARY_EMAIL_SECRET>[&orgId=...]
 */

const APP_NAME = process.env.APP_NAME || "MIS Control Tower";

function authorize(req: Request): { ok: true } | { ok: false; status: number; error: string } {
  const secret = process.env.ROI_SUMMARY_EMAIL_SECRET;
  if (!secret) return { ok: false, status: 503, error: "ROI email endpoint not configured" };
  const authHeader = req.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;
  const urlToken = new URL(req.url).searchParams.get("token");
  if (token === secret || urlToken === secret) return { ok: true };
  return { ok: false, status: 401, error: "Unauthorized" };
}

export async function POST(req: Request) {
  const auth = authorize(req);
  if (!auth.ok) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  const onlyOrgId = new URL(req.url).searchParams.get("orgId");
  const baseUrl = getBaseUrl(req);

  const orgs = await prisma.org.findMany({
    where: onlyOrgId ? { id: onlyOrgId } : {},
    select: { id: true, name: true },
  });

  const sent: string[] = [];
  const failures: Array<{ orgId: string; error: string }> = [];

  for (const org of orgs) {
    try {
      const contacts = await prisma.alertContact.findMany({
        where: { orgId: org.id, isActive: true, email: { not: null } },
        select: { email: true },
      });
      const recipients = [...new Set(contacts.map((c) => c.email).filter((e): e is string => !!e))];
      if (recipients.length === 0) continue;

      const roi = await computeRoi({ orgId: org.id });
      const email = buildRoiSummaryEmail({
        appName: APP_NAME,
        orgName: org.name,
        roi,
        reportUrl: `${baseUrl}/reports/roi`,
      });

      for (const to of recipients) {
        await sendEmail({ to, subject: email.subject, text: email.text, html: email.html });
      }
      sent.push(org.id);
    } catch (err) {
      failures.push({ orgId: org.id, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return NextResponse.json({ ok: true, orgsSent: sent.length, failures });
}
