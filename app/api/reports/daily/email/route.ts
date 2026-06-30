import { NextResponse } from "next/server";
import { getBaseUrl } from "@/lib/appUrl";
import { buildDailyReportEmail, sendEmail } from "@/lib/email";
import { buildWeeklyReport } from "@/lib/reports/weeklyReport";
import { runScheduledReport } from "@/lib/reports/dispatch";
import { tryGenerateReportPdf } from "@/lib/reports/pdf";

/**
 * Daily production-summary email (item 1/4) — the last-24h recap as a scheduled
 * report. Cron-only, secret-gated, fans out across orgs. Off by default per org
 * (opt-in via the Reports settings tab); runScheduledReport gates due-ness.
 *
 *   POST /api/reports/daily/email?token=<DAILY_REPORT_EMAIL_SECRET>[&orgId=...][&force=1]
 */

const APP_NAME = process.env.APP_NAME || "MIS Control Tower";
const DAY_MS = 24 * 60 * 60 * 1000;

function authorize(req: Request): { ok: true } | { ok: false; status: number; error: string } {
  // Falls back to the weekly secret so a single cron credential can drive all report
  // endpoints if a dedicated daily secret isn't configured.
  const secret = process.env.DAILY_REPORT_EMAIL_SECRET || process.env.WEEKLY_REPORT_EMAIL_SECRET;
  if (!secret) return { ok: false, status: 503, error: "Daily report email endpoint not configured" };
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
    reportType: "daily",
    onlyOrgId,
    force,
    send: async ({ org, recipients }) => {
      const to24h = new Date();
      const from24h = new Date(to24h.getTime() - DAY_MS);
      const report = await buildWeeklyReport({
        orgId: org.id,
        from: from24h,
        to: to24h,
        comparePrevious: true,
      });
      const email = buildDailyReportEmail({
        appName: APP_NAME,
        orgName: org.name,
        report,
        reportUrl: `${baseUrl}/recap`,
      });
      const pdf = await tryGenerateReportPdf({
        payload: { type: "daily", orgId: org.id, from: from24h.toISOString(), to: to24h.toISOString() },
        baseUrl,
      });
      const attachments = pdf
        ? [{ filename: "daily_summary.pdf", content: pdf, contentType: "application/pdf" }]
        : undefined;
      for (const recipient of recipients) {
        await sendEmail({
          to: recipient,
          subject: email.subject,
          text: email.text,
          html: email.html,
          attachments,
        });
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
