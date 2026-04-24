import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/requireSession";
import ReportsPageClient from "./ReportsPageClient";

export default async function ReportsPage() {
  const session = await requireSession();
  if (!session) redirect("/login?next=/reports");

  const machines = await prisma.machine.findMany({
    where: { orgId: session.orgId },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true },
  });

  return <ReportsPageClient initialMachines={machines} />;
}
