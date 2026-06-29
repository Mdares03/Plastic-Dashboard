import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOrgAdminSession } from "@/lib/auth/requireOrgAdminSession";
import { buildAssuranceEmail, sendEmail } from "@/lib/email";
import { getBaseUrl } from "@/lib/appUrl";

const APP_NAME = process.env.APP_NAME || "MIS Control Tower";

/**
 * Owner/admin "email the reliability summary" — sends the one-time go-live
 * assurance email to the org's active alert contacts (the same people who get
 * ROI summaries; the decision-maker is among them). Org-scoped, fixed recipients
 * (no arbitrary addresses).
 */
export async function POST(req: Request) {
  const auth = await requireOrgAdminSession();
  if (!auth.ok) return auth.response;
  const { orgId } = auth.session;

  const [org, contacts] = await Promise.all([
    prisma.org.findUnique({ where: { id: orgId }, select: { name: true } }),
    prisma.alertContact.findMany({
      where: { orgId, isActive: true, email: { not: null } },
      select: { email: true },
    }),
  ]);

  const recipients = [...new Set(contacts.map((c) => c.email).filter((e): e is string => !!e))];
  if (recipients.length === 0) {
    return NextResponse.json({ ok: true, sent: 0 });
  }

  const baseUrl = getBaseUrl(req);
  const content = buildAssuranceEmail({
    appName: APP_NAME,
    orgName: org?.name || "your organization",
    trustUrl: `${baseUrl}/trust`,
    roiUrl: `${baseUrl}/reports/roi`,
  });

  let sent = 0;
  for (const to of recipients) {
    try {
      await sendEmail({ to, subject: content.subject, text: content.text, html: content.html });
      sent += 1;
    } catch {
      /* continue; partial send is still useful */
    }
  }

  return NextResponse.json({ ok: true, sent });
}
