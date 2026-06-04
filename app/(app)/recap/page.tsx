import { Suspense } from "react";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/requireSession";
import { getRecapSummaryCached } from "@/lib/recap/redesign";
import RecapGridClient from "./RecapGridClient";
import { RecapGridPageSkeleton } from "./RecapPageSkeletons";

type SearchParams = Record<string, string | string[] | undefined>;

type MachineOption = {
  id: string;
  name: string;
};

function toSingle(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0] ?? undefined;
  return value;
}

function normalizeMachineId(input: string | undefined) {
  const token = String(input ?? "").trim();
  if (!token) return "all";
  if (token.toLowerCase() === "all") return "all";
  return token;
}

async function RecapGridData({ searchParams }: { searchParams?: SearchParams }) {
  const session = await requireSession();
  if (!session) redirect("/login?next=/recap");

  const machineId = normalizeMachineId(toSingle(searchParams?.machineId));
  const machineOptions = await prisma.machine.findMany({
    where: { orgId: session.orgId },
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  const initialData = await getRecapSummaryCached({
    orgId: session.orgId,
    hours: 24,
    machineId,
  });

  return (
    <RecapGridClient
      initialData={initialData}
      machineOptions={machineOptions as MachineOption[]}
      initialMachineId={machineId}
    />
  );
}

export default async function RecapPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const resolvedSearchParams = searchParams ? await searchParams : undefined;

  return (
    <Suspense fallback={<RecapGridPageSkeleton />}>
      <RecapGridData searchParams={resolvedSearchParams} />
    </Suspense>
  );
}
