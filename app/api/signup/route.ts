import { NextResponse } from "next/server";
import bcrypt from "bcrypt";
import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import { DEFAULT_ALERTS, DEFAULT_DEFAULTS, DEFAULT_SHIFT } from "@/lib/settings";
import { buildVerifyEmail, sendEmail } from "@/lib/email";
import { getBaseUrl } from "@/lib/appUrl";
import { logLine } from "@/lib/logger";
import { z } from "zod";

const signupSchema = z.object({
  orgName: z.string().trim().min(1).max(120),
  name: z.string().trim().min(1).max(80),
  email: z.string().trim().min(1).max(254).email(),
  password: z.string().min(8).max(256),
});

function slugify(input: string) {
  const trimmed = input.trim().toLowerCase();
  const slug = trimmed
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "org";
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const parsed = signupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid signup payload" }, { status: 400 });
  }
  const orgName = parsed.data.orgName;
  const name = parsed.data.name;
  const email = parsed.data.email.toLowerCase();
  const password = parsed.data.password;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json({ ok: false, error: "Email already in use" }, { status: 409 });
  }

  const baseSlug = slugify(orgName);
  let slug = baseSlug;
  let counter = 1;
  while (await prisma.org.findUnique({ where: { slug } })) {
    counter += 1;
    slug = `${baseSlug}-${counter}`;
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const verificationToken = randomBytes(24).toString("hex");
  const verificationExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  await prisma.$transaction(async (tx) => {
    const org = await tx.org.create({
      data: { name: orgName, slug },
    });

    const user = await tx.user.create({
      data: {
        email,
        name,
        passwordHash,
        emailVerificationToken: verificationToken,
        emailVerificationExpiresAt: verificationExpiresAt,
      },
    });

    await tx.orgUser.create({
      data: {
        orgId: org.id,
        userId: user.id,
        role: "OWNER",
      },
    });

    await tx.orgSettings.create({
      data: {
        orgId: org.id,
        timezone: "UTC",
        shiftChangeCompMin: 10,
        lunchBreakMin: 30,
        stoppageMultiplier: 1.5,
        macroStoppageMultiplier: 5,
        oeeAlertThresholdPct: 90,
        performanceThresholdPct: 85,
        qualitySpikeDeltaPct: 5,
        alertsJson: DEFAULT_ALERTS,
        defaultsJson: DEFAULT_DEFAULTS,
        updatedBy: user.id,
      },
    });

    await tx.orgShift.create({
      data: {
        orgId: org.id,
        name: DEFAULT_SHIFT.name,
        startTime: DEFAULT_SHIFT.start,
        endTime: DEFAULT_SHIFT.end,
        sortOrder: 1,
        enabled: true,
      },
    });

    return { org, user };
  });

  const baseUrl = getBaseUrl(req);
  const verifyUrl = `${baseUrl}/api/verify-email?token=${verificationToken}`;
  const appName = "MIS Control Tower";
  const emailContent = buildVerifyEmail({ appName, verifyUrl });

  let emailSent = true;
  try {
    await sendEmail({
      to: email,
      subject: emailContent.subject,
      text: emailContent.text,
      html: emailContent.html,
    });
  } catch (err: unknown) {
    emailSent = false;
    const error = err as { message?: string; code?: string; response?: unknown; responseCode?: number };
    logLine("signup.verify_email.failed", {
      email,
      message: error?.message,
      code: error?.code,
      response: error?.response,
      responseCode: error?.responseCode,
    });
  }
  return NextResponse.json({
    ok: true,
    verificationRequired: true,
    emailSent,
  });
}
