import { AppShell } from "@/components/layout/AppShell";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";

const COOKIE_NAME = "mis_session";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const cookieJar = await cookies();
  const sessionId = cookieJar.get(COOKIE_NAME)?.value;
  const themeCookie = cookieJar.get("mis_theme")?.value;
  const initialTheme = themeCookie === "light" ? "light" : "dark";

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

  return <AppShell initialTheme={initialTheme}>{children}</AppShell>;
}
