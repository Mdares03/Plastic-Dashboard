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

export default async function ActionItemsLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  if (!session) redirect("/login?next=/action-items");

  const settings = await prisma.orgSettings.findUnique({
    where: { orgId: session.orgId },
    select: { defaultsJson: true },
  });

  // Action Items originate from downtime reasons, so they share the same
  // screenless-mode gating as /downtime (hide both together).
  if (getScreenlessMode(settings?.defaultsJson)) {
    redirect("/overview");
  }

  return <>{children}</>;
}
