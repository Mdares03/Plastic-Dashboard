import { redirect } from "next/navigation";

export default async function LegacyDowntimeParetoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === "string") qs.set(k, v);
    else if (Array.isArray(v)) v.forEach((vv) => qs.append(k, vv));
  }
  const q = qs.toString();
  redirect(q ? `/downtime?${q}` : "/downtime");
}
