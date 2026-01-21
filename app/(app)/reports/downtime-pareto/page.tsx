import { redirect } from "next/navigation";

export default function LegacyDowntimeParetoPage({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(searchParams)) {
    if (typeof v === "string") qs.set(k, v);
    else if (Array.isArray(v)) v.forEach((vv) => qs.append(k, vv));
  }
  const q = qs.toString();
  redirect(q ? `/downtime?${q}` : "/downtime");
}
