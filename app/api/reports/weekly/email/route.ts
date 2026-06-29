import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getBaseUrl } from "@/lib/appUrl";
import { buildWeeklyReportEmail, sendEmail } from "@/lib/email";
import { buildWeeklyReport } from "@/lib/reports/weeklyReport";

/**
 * Weekly production-summary email. Cron-only, secret-gated (fail-closed, same
 * model as the ROI summary + downtime-action reminders): it fans out across
 * every org, so there is no safe logged-in caller. Schedule it (cron/systemd) to
 * POST here weekly.
 *
 *   POST /api/reports/weekly/email?token=<WEEKLY_REPORT_EMAIL_SECRET>[&orgId=...]
 */

const APP_NAME = process.env.APP_NAME || "MIS Control Tower";

function authorize(req: Request): { ok: true } | { ok: false; status: number; error: string } {
  const secret = process.env.WEEKLY_REPORT_EMAIL_SECRET;
  if (!secret) return { ok: false, status: 503, error: "Weekly report email endpoint not configured" };
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

      const report = await buildWeeklyReport({ orgId: org.id });
      const email = buildWeeklyReportEmail({
        appName: APP_NAME,
        orgName: org.name,
        report,
        reportUrl: `${baseUrl}/reports/weekly`,
      });

      for (const to of recipients) {
        await sendEmail({ to, subject: email.subject, text: email.text, html: email.html });
        sent.push(to);
      }
    } catch (err) {
      failures.push({ orgId: org.id, error: err instanceof Error ? err.message : "Failed" });
    }
  }

  return NextResponse.json({ ok: true, sentCount: sent.length, failures });
}
