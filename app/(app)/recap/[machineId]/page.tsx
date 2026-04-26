import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/requireSession";
import { getRecapMachineDetailCached, parseRecapDetailRangeInput } from "@/lib/recap/redesign";
import { RecapDetailPageSkeleton } from "../RecapPageSkeletons";
import RecapDetailClient from "./RecapDetailClient";

async function RecapDetailData({
  params,
  searchParams,
}: {
  params: Promise<{ machineId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  const { machineId } = await params;
  if (!session) redirect(`/login?next=/recap/${machineId}`);

  const rawSearchParams = (await searchParams) ?? {};
  const input = parseRecapDetailRangeInput(rawSearchParams);

  const initialData = await getRecapMachineDetailCached({
    orgId: session.orgId,
    machineId,
    input,
  });

  if (!initialData) notFound();

  return (
    <RecapDetailClient
      key={`${machineId}:${initialData.range.mode}:${initialData.range.start}:${initialData.range.end}`}
      machineId={machineId}
      initialData={initialData}
    />
  );
}

export default function RecapMachineDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ machineId: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  return (
    <Suspense fallback={<RecapDetailPageSkeleton />}>
      <RecapDetailData params={params} searchParams={searchParams} />
    </Suspense>
  );
}
