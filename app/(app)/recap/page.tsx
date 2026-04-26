import { Suspense } from "react";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/requireSession";
import { getRecapSummaryCached } from "@/lib/recap/redesign";
import RecapGridClient from "./RecapGridClient";
import { RecapGridPageSkeleton } from "./RecapPageSkeletons";

async function RecapGridData() {
  const session = await requireSession();
  if (!session) redirect("/login?next=/recap");

  const initialData = await getRecapSummaryCached({
    orgId: session.orgId,
    hours: 24,
  });

  return <RecapGridClient initialData={initialData} />;
}

export default function RecapPage() {
  return (
    <Suspense fallback={<RecapGridPageSkeleton />}>
      <RecapGridData />
    </Suspense>
  );
}
