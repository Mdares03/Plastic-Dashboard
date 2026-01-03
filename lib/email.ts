import nodemailer from "nodemailer";

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

  cachedTransport = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });

  return cachedTransport;
}

export async function sendEmail(payload: EmailPayload) {
  const from = process.env.SMTP_FROM || process.env.SMTP_USER;
  if (!from) {
    throw new Error("SMTP_FROM not configured");
  }

  const transporter = getTransporter();
  return transporter.sendMail({
    from,
    to: payload.to,
    subject: payload.subject,
    text: payload.text,
    html: payload.html,
  });
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
