import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOrgAdminSession } from "@/lib/auth/requireOrgAdminSession";
import { buildTestAlertEmail, sendEmail } from "@/lib/email";
import { getBaseUrl } from "@/lib/appUrl";

const APP_NAME = process.env.APP_NAME || "MIS Control Tower";

/**
 * Owner/admin "send me a test alert" — delivers one clearly-labeled sample alert
 * to the requesting user's own email, so a client can experience the new sane
 * alert format on day 1 without waiting for a real incident. Self-targeted only
 * (no arbitrary recipient), so it can't be abused to email others.
 */
export async function POST(req: Request) {
  const auth = await requireOrgAdminSession();
  if (!auth.ok) return auth.response;
  const { orgId, userId } = auth.session;

  const [user, org] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } }),
    prisma.org.findUnique({ where: { id: orgId }, select: { name: true } }),
  ]);

  if (!user?.email) {
    return NextResponse.json({ ok: false, error: "No email on your account" }, { status: 400 });
  }

  const content = buildTestAlertEmail({
    appName: APP_NAME,
    orgName: org?.name || "your organization",
    recipientName: user.name || user.email,
    alertsUrl: `${getBaseUrl(req)}/alerts`,
  });

  try {
    await sendEmail({ to: user.email, subject: content.subject, text: content.text, html: content.html });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Failed to send test alert" },
      { status: 502 },
    );
  }

  return NextResponse.json({ ok: true, sentTo: user.email });
}
