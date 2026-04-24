import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/requireSession";
import { getRecapDataCached, parseRecapQuery } from "@/lib/recap/getRecapData";
import RecapClient from "./RecapClient";

export default async function RecapPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await requireSession();
  if (!session) redirect("/login?next=/recap");

  const params = (await searchParams) ?? {};
  const getParam = (key: string) => {
    const value = params[key];
    return Array.isArray(value) ? value[0] : value;
  };

  const parsed = parseRecapQuery({
    machineId: getParam("machineId"),
    start: getParam("start"),
    end: getParam("end"),
    shift: getParam("shift"),
  });

  const initialData = await getRecapDataCached({
    orgId: session.orgId,
    machineId: parsed.machineId,
    start: parsed.start ?? undefined,
    end: parsed.end ?? undefined,
    shift: parsed.shift ?? undefined,
  });

  return (
    <RecapClient
      initialData={initialData}
      initialFilters={{
        machineId: parsed.machineId ?? "",
        shift: parsed.shift ?? "",
        start: parsed.start?.toISOString() ?? "",
        end: parsed.end?.toISOString() ?? "",
      }}
    />
  );
}
