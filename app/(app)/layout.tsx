import { AppShell } from "@/components/layout/AppShell";
import type { SidebarMe } from "@/components/layout/Sidebar";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/requireSession";

export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieJar = await cookies();
  const themeCookie = cookieJar.get("mis_theme")?.value;
  const initialTheme = themeCookie === "light" ? "light" : "dark";

  // Validate the session (DB-backed, 10s in-process cache so it's effectively free
  // alongside each page's own requireSession) and seed the shell user from the
  // server — the sidebar no longer fetches /api/me on mount or flashes "User /
  // Loading…".
  const session = await requireSession();
  if (!session) redirect("/login");

  const { userId, orgId } = session;
  const [user, org, membership] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { name: true, email: true } }),
    prisma.org.findUnique({ where: { id: orgId }, select: { name: true } }),
    prisma.orgUser.findUnique({
      where: { orgId_userId: { orgId, userId } },
      select: { role: true },
    }),
  ]);
  const initialMe: SidebarMe = {
    user: user ?? undefined,
    org: org ?? undefined,
    membership: membership ?? undefined,
  };

  return (
    <AppShell initialTheme={initialTheme} initialMe={initialMe}>
      {children}
    </AppShell>
  );
}
