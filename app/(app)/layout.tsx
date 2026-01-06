import { AppShell } from "@/components/layout/AppShell";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";

const COOKIE_NAME = "mis_session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const sessionId = (await cookies()).get(COOKIE_NAME)?.value;

  if (!sessionId) redirect("/login?next=/machines");

  // validate session in DB (don’t trust cookie existence)
  const session = await prisma.session.findFirst({
    where: {
      id: sessionId,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    include: { user: true, org: true },
  });

  if (!session || !session.user?.isActive || !session.user?.emailVerifiedAt) {
    redirect("/login?next=/machines");
  }

  return <AppShell>{children}</AppShell>;
}
