import { AppShell } from "@/components/layout/AppShell";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

const COOKIE_NAME = "mis_session";

export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieJar = await cookies();
  const sessionId = cookieJar.get(COOKIE_NAME)?.value;
  const themeCookie = cookieJar.get("mis_theme")?.value;
  const initialTheme = themeCookie === "light" ? "light" : "dark";

  if (!sessionId) redirect("/login");

  return <AppShell initialTheme={initialTheme}>{children}</AppShell>;
}
