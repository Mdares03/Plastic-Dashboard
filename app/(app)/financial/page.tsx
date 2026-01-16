import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/requireSession";
import { computeFinancialImpact } from "@/lib/financial/impact";
import FinancialClient from "./FinancialClient";

const RANGE_MS = 7 * 24 * 60 * 60 * 1000;

export default async function FinancialPage() {
  const session = await requireSession();
  if (!session) redirect("/login?next=/financial");

  const membership = await prisma.orgUser.findUnique({
    where: { orgId_userId: { orgId: session.orgId, userId: session.userId } },
    select: { role: true },
  });

  const role = membership?.role ?? null;
  if (role !== "OWNER") {
    return <FinancialClient initialRole={role ?? "GUEST"} />;
  }

  const machines = await prisma.machine.findMany({
    where: { orgId: session.orgId },
    orderBy: { createdAt: "desc" },
    select: { id: true, name: true, location: true },
  });

  const end = new Date();
  const start = new Date(end.getTime() - RANGE_MS);
  const impact = await computeFinancialImpact({
    orgId: session.orgId,
    start,
    end,
    includeEvents: false,
  });

  return (
    <FinancialClient
      initialRole={role}
      initialMachines={machines}
      initialImpact={{ ok: true, currencySummaries: impact.currencySummaries }}
    />
  );
}
