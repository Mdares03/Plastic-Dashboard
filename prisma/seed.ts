import { PrismaClient } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();

async function main() {
  const passwordHash = await bcrypt.hash("admin123", 10);

  const org = await prisma.org.upsert({
    where: { slug: "maliountech" },
    update: {},
    create: {
      name: "MaliounTech",
      slug: "maliountech",
    },
  });

  const user = await prisma.user.upsert({
    where: { email: "admin@maliountech.com" },
    update: {
      emailVerifiedAt: new Date(),
    },
    create: {
      email: "admin@maliountech.com",
      name: "Admin",
      passwordHash,
      emailVerifiedAt: new Date(),
    },
  });

  await prisma.orgUser.upsert({
    where: {
      orgId_userId: {
        orgId: org.id,
        userId: user.id,
      },
    },
    update: {},
    create: {
      orgId: org.id,
      userId: user.id,
      role: "OWNER",
    },
  });

  await prisma.orgSettings.upsert({
    where: { orgId: org.id },
    update: {},
    create: {
      orgId: org.id,
      timezone: "UTC",
      shiftChangeCompMin: 10,
      lunchBreakMin: 30,
      stoppageMultiplier: 1.5,
      oeeAlertThresholdPct: 90,
      macroStoppageMultiplier: 5,
      performanceThresholdPct: 85,
      qualitySpikeDeltaPct: 5,
      alertsJson: {
        oeeDropEnabled: true,
        performanceDegradationEnabled: true,
        qualitySpikeEnabled: true,
        predictiveOeeDeclineEnabled: true,
      },
      defaultsJson: {
        moldTotal: 1,
        moldActive: 1,
      },
    },
  });

  const existingShift = await prisma.orgShift.findFirst({
    where: { orgId: org.id },
  });

  if (!existingShift) {
    await prisma.orgShift.create({
      data: {
        orgId: org.id,
        name: "Shift 1",
        startTime: "06:00",
        endTime: "15:00",
        sortOrder: 1,
        enabled: true,
      },
    });
  }

  console.log("Seeded admin user");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
