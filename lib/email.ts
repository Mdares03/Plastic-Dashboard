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
    logLine("email.send.ok", {
      to: payload.to,
      from,
      messageId: info.messageId,
      response: info.response,
      accepted: info.accepted,
      rejected: info.rejected,
      pending: (info as any).pending,
    });

    return info;
  } catch (err: any) {
    logLine("email.send.err", {
      to: payload.to,
      from,
      name: err?.name,
      message: err?.message,
      code: err?.code,
      command: err?.command,
      response: err?.response,
      responseCode: err?.responseCode,
      stack: err?.stack,
    });
    throw err;
  }
  
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
