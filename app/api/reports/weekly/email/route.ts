import { NextResponse } from "next/server";
import { getBaseUrl } from "@/lib/appUrl";
import { buildWeeklyReportEmail, sendEmail } from "@/lib/email";
import { buildWeeklyReport } from "@/lib/reports/weeklyReport";
import { runScheduledReport } from "@/lib/reports/dispatch";
import { tryGenerateReportPdf } from "@/lib/reports/pdf";

/**
 * Weekly production-summary email. Cron-only, secret-gated (fail-closed, same
 * model as the ROI summary + downtime-action reminders): it fans out across
 * every org, so there is no safe logged-in caller.
 *
 * Per-org scheduling (item 1): the cron may run as often as hourly; runScheduledReport
 * decides per-org due-ness from OrgReportSchedule (recipients, cadence, lastSentAt
 * dedupe), so this endpoint no longer blindly sends every call.
 *
 *   POST /api/reports/weekly/email?token=<WEEKLY_REPORT_EMAIL_SECRET>[&orgId=...][&force=1]
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

  const url = new URL(req.url);
  const onlyOrgId = url.searchParams.get("orgId");
  const force = url.searchParams.get("force") === "1";
  const baseUrl = getBaseUrl(req);

  const result = await runScheduledReport({
    reportType: "weekly",
    onlyOrgId,
    force,
    send: async ({ org, recipients }) => {
      const report = await buildWeeklyReport({ orgId: org.id, comparePrevious: true });
      const email = buildWeeklyReportEmail({
        appName: APP_NAME,
        orgName: org.name,
        report,
        reportUrl: `${baseUrl}/reports/weekly`,
      });
      // Best-effort PDF attachment — if Chromium isn't available the email still sends.
      const pdf = await tryGenerateReportPdf({ payload: { type: "weekly", orgId: org.id }, baseUrl });
      const attachments = pdf
        ? [{ filename: "weekly_report.pdf", content: pdf, contentType: "application/pdf" }]
        : undefined;
      for (const to of recipients) {
        await sendEmail({ to, subject: email.subject, text: email.text, html: email.html, attachments });
      }
    },
  });

  return NextResponse.json({
    ok: true,
    sentCount: result.sent.length,
    skipped: result.skipped,
    failures: result.failures,
  });
}
