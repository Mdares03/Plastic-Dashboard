import nodemailer from "nodemailer";
import { logLine } from "@/lib/logger";
type EmailPayload = {
  to: string;
  subject: string;
  text: string;
  html: string;
};

let cachedTransport: nodemailer.Transporter | null = null;

function getTransporter() {
  if (cachedTransport) return cachedTransport;

  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 465);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const secure =
    process.env.SMTP_SECURE !== undefined
      ? process.env.SMTP_SECURE === "true"
      : port === 465;

  if (!host || !user || !pass) {
    throw new Error("SMTP not configured");
  }

  const smtpDebug = process.env.SMTP_DEBUG === "true";
  logLine("smtp.config", {
    host,
    port,
    secure,
    user,
    from: process.env.SMTP_FROM,
    smtpDebug,
  });

  cachedTransport = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    logger: smtpDebug,
    debug: smtpDebug,
  });

  return cachedTransport;
}

/** SMTP send attempts (1 try + 2 retries) for transient failures. */
const EMAIL_MAX_ATTEMPTS = 3;
/** Backoff before retry N (ms): ~0.5s, ~1.5s. */
const EMAIL_RETRY_BACKOFF_MS = [500, 1500];

type SmtpErrorShape = {
  name?: string;
  message?: string;
  code?: string;
  command?: string;
  response?: unknown;
  responseCode?: number;
  stack?: string;
};

/**
 * Transient = worth retrying: network blips (ECONNRESET/ETIMEDOUT/…), connection
 * errors, and SMTP 4xx "try again later" replies. Permanent (5xx, bad recipient,
 * auth) is not retried — retrying can't fix it and just delays the failure record.
 */
function isTransientSmtpError(err: SmtpErrorShape): boolean {
  const code = String(err?.code ?? "").toUpperCase();
  if (
    code === "ECONNRESET" ||
    code === "ETIMEDOUT" ||
    code === "ESOCKET" ||
    code === "ECONNECTION" ||
    code === "EAI_AGAIN" ||
    code === "ETIMEOUT"
  ) {
    return true;
  }
  const rc = Number(err?.responseCode);
  if (Number.isFinite(rc) && rc >= 400 && rc < 500) return true; // 4xx = greylist/try-later
  return false;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function sendEmail(payload: EmailPayload) {
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  if (!from) {
    throw new Error("SMTP_FROM not configured");
  }
  logLine("email.send.start", {
    to: payload.to,
    subject: payload.subject,
    from,
  });

  const transporter = getTransporter();
  let lastErr: unknown;

  for (let attempt = 1; attempt <= EMAIL_MAX_ATTEMPTS; attempt += 1) {
    try {
      const info = await transporter.sendMail({
        from,
        to: payload.to,
        subject: payload.subject,
        text: payload.text,
        html: payload.html,
        headers: {
          "X-Mailer": "MIS Control Tower",
        },

        replyTo: from,
      });

      // Nodemailer response details:
      const pending = "pending" in info ? (info as { pending?: string[] }).pending : undefined;
      logLine("email.send.ok", {
        to: payload.to,
        from,
        attempt,
        messageId: info.messageId,
        response: info.response,
        accepted: info.accepted,
        rejected: info.rejected,
        pending,
      });

      return info;
    } catch (err: unknown) {
      lastErr = err;
      const error = err as SmtpErrorShape;
      const transient = isTransientSmtpError(error);
      const willRetry = transient && attempt < EMAIL_MAX_ATTEMPTS;
      logLine("email.send.err", {
        to: payload.to,
        from,
        attempt,
        transient,
        willRetry,
        name: error?.name,
        message: error?.message,
        code: error?.code,
        command: error?.command,
        response: error?.response,
        responseCode: error?.responseCode,
        stack: error?.stack,
      });
      if (!willRetry) throw err;
      await sleep(EMAIL_RETRY_BACKOFF_MS[attempt - 1] ?? 1500);
    }
  }

  throw lastErr;
}

export function buildVerifyEmail(params: { appName: string; verifyUrl: string }) {
  const subject = `Verify your ${params.appName} account`;
  const text =
    `Welcome to ${params.appName}.\n\n` +
    `Verify your email to activate your account:\n${params.verifyUrl}\n\n` +
    `If you did not request this, ignore this email.`;
  const html =
    `<p>Welcome to ${params.appName}.</p>` +
    `<p>Verify your email to activate your account:</p>` +
    `<p><a href="${params.verifyUrl}">${params.verifyUrl}</a></p>` +
    `<p>If you did not request this, ignore this email.</p>`;

  return { subject, text, html };
}

export function buildInviteEmail(params: {
  appName: string;
  orgName: string;
  inviteUrl: string;
}) {
  const subject = `You're invited to ${params.orgName} on ${params.appName}`;
  const text =
    `You have been invited to join ${params.orgName} on ${params.appName}.\n\n` +
    `Accept the invite here:\n${params.inviteUrl}\n\n` +
    `If you did not expect this invite, you can ignore this email.`;
  const html =
    `<p>You have been invited to join ${params.orgName} on ${params.appName}.</p>` +
    `<p>Accept the invite here:</p>` +
    `<p><a href="${params.inviteUrl}">${params.inviteUrl}</a></p>` +
    `<p>If you did not expect this invite, you can ignore this email.</p>`;

  return { subject, text, html };
}

export function buildDowntimeActionAssignedEmail(params: {
  appName: string;
  orgName: string;
  actionTitle: string;
  assigneeName: string;
  dueDate: string | null;
  actionUrl: string;
  priority: string;
  status: string;
}) {
  const dueLabel = params.dueDate ? `Due ${params.dueDate}` : "No due date";
  const subject = `Action assigned: ${params.actionTitle}`;
  const text =
    `Hi ${params.assigneeName},\n\n` +
    `You have been assigned an action in ${params.orgName} (${params.appName}).\n\n` +
    `Title: ${params.actionTitle}\n` +
    `Status: ${params.status}\n` +
    `Priority: ${params.priority}\n` +
    `${dueLabel}\n\n` +
    `Open in Control Tower:\n${params.actionUrl}\n\n` +
    `If you did not expect this assignment, please contact your admin.`;
  const html =
    `<p>Hi ${params.assigneeName},</p>` +
    `<p>You have been assigned an action in ${params.orgName} (${params.appName}).</p>` +
    `<p><strong>Title:</strong> ${params.actionTitle}<br />` +
    `<strong>Status:</strong> ${params.status}<br />` +
    `<strong>Priority:</strong> ${params.priority}<br />` +
    `<strong>${dueLabel}</strong></p>` +
    `<p><a href="${params.actionUrl}">Open in Control Tower</a></p>` +
    `<p>If you did not expect this assignment, please contact your admin.</p>`;

  return { subject, text, html };
}

export function buildDowntimeActionReminderEmail(params: {
  appName: string;
  orgName: string;
  actionTitle: string;
  assigneeName: string;
  dueDate: string | null;
  actionUrl: string;
  priority: string;
  status: string;
}) {
  const dueLabel = params.dueDate ? `Due ${params.dueDate}` : "No due date";
  const subject = `Reminder: ${params.actionTitle}`;
  const text =
    `Hi ${params.assigneeName},\n\n` +
    `Reminder for your action in ${params.orgName} (${params.appName}).\n\n` +
    `Title: ${params.actionTitle}\n` +
    `Status: ${params.status}\n` +
    `Priority: ${params.priority}\n` +
    `${dueLabel}\n\n` +
    `Open in Control Tower:\n${params.actionUrl}\n\n` +
    `If you have already completed this action, you can mark it done in the app.`;
  const html =
    `<p>Hi ${params.assigneeName},</p>` +
    `<p>Reminder for your action in ${params.orgName} (${params.appName}).</p>` +
    `<p><strong>Title:</strong> ${params.actionTitle}<br />` +
    `<strong>Status:</strong> ${params.status}<br />` +
    `<strong>Priority:</strong> ${params.priority}<br />` +
    `<strong>${dueLabel}</strong></p>` +
    `<p><a href="${params.actionUrl}">Open in Control Tower</a></p>` +
    `<p>If you have already completed this action, you can mark it done in the app.</p>`;

  return { subject, text, html };
}

/**
 * C5 — weekly/monthly ROI summary email. Pure builder (unit-tested); the trigger endpoint
 * computes the ROI and calls sendEmail with this. Money line is omitted when cost rates are
 * still placeholders, so we never email an illustrative peso figure as if it were real.
 */
export function buildRoiSummaryEmail(params: {
  appName: string;
  orgName: string;
  roi: {
    baseline: { unplannedMinPerDay: number };
    current: { unplannedMinPerDay: number };
    targetReductionPct: number;
    achievedReductionPct: number | null;
    meetsTarget: boolean;
    estimatedMonthlySavings: number;
    currency: string;
    costRatesArePlaceholder: boolean;
  };
  reportUrl: string;
}) {
  const { roi } = params;
  const reduction = roi.achievedReductionPct == null ? "—" : `${roi.achievedReductionPct.toFixed(1)}%`;
  const status = roi.meetsTarget ? "on/above target" : "below target";
  const moneyLine = roi.costRatesArePlaceholder
    ? "Money savings: not shown (cost rates not configured yet)."
    : `Estimated monthly savings: ${roi.currency} ${roi.estimatedMonthlySavings.toLocaleString()}.`;

  const subject = `${params.orgName}: downtime reduction ${reduction} (target ≥${roi.targetReductionPct}%)`;
  const text =
    `ROI summary for ${params.orgName} (${params.appName}).\n\n` +
    `Reduction vs baseline: ${reduction} — ${status} (target ≥${roi.targetReductionPct}%).\n` +
    `Baseline: ${roi.baseline.unplannedMinPerDay.toFixed(0)} min/day → Current: ${roi.current.unplannedMinPerDay.toFixed(0)} min/day.\n` +
    `${moneyLine}\n\n` +
    `Open the ROI tracker:\n${params.reportUrl}`;
  const html =
    `<p>ROI summary for <strong>${params.orgName}</strong> (${params.appName}).</p>` +
    `<p><strong>Reduction vs baseline: ${reduction}</strong> — ${status} (target ≥${roi.targetReductionPct}%).</p>` +
    `<p>Baseline: ${roi.baseline.unplannedMinPerDay.toFixed(0)} min/day → Current: ${roi.current.unplannedMinPerDay.toFixed(0)} min/day.</p>` +
    `<p>${moneyLine}</p>` +
    `<p><a href="${params.reportUrl}">Open the ROI tracker</a></p>`;

  return { subject, text, html };
}

/**
 * A clearly-labeled sample alert so a client can experience the new (throttled,
 * sane) alert format once — proving deliverability and that alerts work, without
 * waiting for a real incident.
 */
export function buildTestAlertEmail(params: {
  appName: string;
  orgName: string;
  recipientName: string;
  alertsUrl: string;
}) {
  const subject = `[TEST] ${params.appName} alert — delivery check`;
  const text =
    `This is a TEST alert from ${params.appName} for ${params.orgName}.\n\n` +
    `Hi ${params.recipientName}, you requested a test to confirm alerts reach you.\n` +
    `If you received this, alert delivery is working. Real alerts are throttled: ` +
    `one per incident, with an hourly safety cap — no more flooding.\n\n` +
    `Alerts inbox:\n${params.alertsUrl}`;
  const html =
    `<p>This is a <strong>TEST</strong> alert from ${params.appName} for <strong>${params.orgName}</strong>.</p>` +
    `<p>Hi ${params.recipientName}, you requested a test to confirm alerts reach you.</p>` +
    `<p>If you received this, alert delivery is working. Real alerts are throttled: ` +
    `<strong>one per incident</strong>, with an hourly safety cap — no more flooding.</p>` +
    `<p><a href="${params.alertsUrl}">Open the alerts inbox</a></p>`;

  return { subject, text, html };
}

function fmtMxn(value: number) {
  return new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", maximumFractionDigits: 0 }).format(value);
}

function fmtShortDate(iso: string) {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toISOString().slice(0, 10);
}

/**
 * Weekly production summary email — the recurring, exec-readable artifact that
 * lands in the decision-maker's inbox. Headline KPIs only, with a link to the
 * full report. Money is omitted (not faked) when cost rates are unset.
 */
export function buildWeeklyReportEmail(params: {
  appName: string;
  orgName: string;
  report: {
    period: { from: string; to: string };
    oeeAvg: number;
    production: { good: number; target: number; pct: number };
    estimatedLossMXN: number;
    financialVisibility: { hasAnyCost: boolean };
    classificationRate: number;
    classificationTarget: number;
  };
  reportUrl: string;
}) {
  const { report } = params;
  const from = fmtShortDate(report.period.from);
  const to = fmtShortDate(report.period.to);
  const oee = `${report.oeeAvg.toFixed(0)}%`;
  const prod = `${report.production.good.toLocaleString()} / ${report.production.target.toLocaleString()} (${report.production.pct.toFixed(0)}%)`;
  const lossLine = report.financialVisibility.hasAnyCost
    ? `Estimated loss: ${fmtMxn(report.estimatedLossMXN)}.`
    : "Estimated loss: not shown (cost rates not configured yet).";
  const classified = `${(report.classificationRate * 100).toFixed(0)}% (target ≥${(report.classificationTarget * 100).toFixed(0)}%)`;

  const subject = `${params.orgName}: weekly production summary (${from} → ${to})`;
  const text =
    `Weekly summary for ${params.orgName} (${params.appName}), ${from} → ${to}.\n\n` +
    `OEE (avg): ${oee}.\n` +
    `Production (good/target): ${prod}.\n` +
    `${lossLine}\n` +
    `Downtime classified: ${classified}.\n\n` +
    `Open the full report:\n${params.reportUrl}`;
  const html =
    `<p>Weekly summary for <strong>${params.orgName}</strong> (${params.appName}), ${from} → ${to}.</p>` +
    `<ul>` +
    `<li><strong>OEE (avg):</strong> ${oee}</li>` +
    `<li><strong>Production (good/target):</strong> ${prod}</li>` +
    `<li><strong>${lossLine}</strong></li>` +
    `<li><strong>Downtime classified:</strong> ${classified}</li>` +
    `</ul>` +
    `<p><a href="${params.reportUrl}">Open the full report</a></p>`;

  return { subject, text, html };
}

/**
 * One-time "reliability restored" assurance email — the go-live summary for the
 * decision-maker: numbers reconcile, alerts are throttled, security is hardened,
 * with links to the live proof.
 */
export function buildAssuranceEmail(params: {
  appName: string;
  orgName: string;
  trustUrl: string;
  roiUrl: string;
}) {
  const subject = `${params.orgName}: reliability restored — ${params.appName}`;
  const points = [
    "Every number reconciles — the dashboard, reports and financial/ROI figures all read from one source, verified live.",
    "Alerts are throttled — one alert per incident with an hourly safety cap. No more flooding.",
    "Security is hardened — rate limiting, fixed token leaks, faster session revocation.",
    "Downtime is shift-aware and capped — no runaway stop can inflate the numbers.",
  ];
  const text =
    `${params.orgName} — reliability update (${params.appName}).\n\n` +
    points.map((p) => `• ${p}`).join("\n") +
    `\n\nSee the live proof:\n${params.trustUrl}\n\nROI tracker:\n${params.roiUrl}`;
  const html =
    `<p><strong>${params.orgName} — reliability update</strong> (${params.appName}).</p>` +
    `<ul>${points.map((p) => `<li>${p}</li>`).join("")}</ul>` +
    `<p><a href="${params.trustUrl}">See the live proof</a> · <a href="${params.roiUrl}">ROI tracker</a></p>`;

  return { subject, text, html };
}
