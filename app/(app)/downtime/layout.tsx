import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/requireSession";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function getScreenlessMode(defaultsJson: unknown) {
  const defaults = isPlainObject(defaultsJson) ? defaultsJson : {};
  const modules = isPlainObject(defaults.modules) ? defaults.modules : {};
  return modules.screenlessMode === true;
}

export default async function DowntimeLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  if (!session) redirect("/login?next=/downtime");

  const settings = await prisma.orgSettings.findUnique({
    where: { orgId: session.orgId },
    select: { defaultsJson: true },
  });

  if (getScreenlessMode(settings?.defaultsJson)) {
    redirect("/overview");
  }

  return <>{children}</>;
}
