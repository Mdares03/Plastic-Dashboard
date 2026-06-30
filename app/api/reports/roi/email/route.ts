import { NextResponse } from "next/server";
import { getBaseUrl } from "@/lib/appUrl";
import { buildRoiSummaryEmail, sendEmail } from "@/lib/email";
import { computeRoi } from "@/lib/reports/roi";
import { runScheduledReport } from "@/lib/reports/dispatch";

/**
 * C5 — weekly/monthly ROI summary email. Cron-only, secret-gated (fail-closed, same model as
 * the downtime-action reminders): it fans out across every org, so there is no safe logged-in
 * caller.
 *
 * Per-org scheduling (item 1): runScheduledReport reads OrgReportSchedule (reportType "roi")
 * to decide due-ness, recipients and dedupe, so the cron can run frequently without resending.
 *
 *   POST /api/reports/roi/email?token=<ROI_SUMMARY_EMAIL_SECRET>[&orgId=...][&force=1]
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

  const url = new URL(req.url);
  const onlyOrgId = url.searchParams.get("orgId");
  const force = url.searchParams.get("force") === "1";
  const baseUrl = getBaseUrl(req);

  const result = await runScheduledReport({
    reportType: "roi",
    onlyOrgId,
    force,
    send: async ({ org, recipients }) => {
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
    },
  });

  return NextResponse.json({
    ok: true,
    orgsSent: result.sent.length,
    skipped: result.skipped,
    failures: result.failures,
  });
}
