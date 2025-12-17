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
    update: {},
    create: {
      email: "admin@maliountech.com",
      name: "Admin",
      passwordHash,
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

  console.log("Seeded admin user");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
