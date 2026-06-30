import { NextResponse } from "next/server";
import { requireOrgAdminSession } from "@/lib/auth/requireOrgAdminSession";
import { buildOnboardingTemplateJson } from "@/lib/onboarding/template";

/** Download the onboarding config template (item 8). Admin/owner only. */
export async function GET() {
  const auth = await requireOrgAdminSession();
  if (!auth.ok) return auth.response;

  return new NextResponse(buildOnboardingTemplateJson(), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": 'attachment; filename="maliountech-onboarding-template.json"',
      "Cache-Control": "no-store",
    },
  });
}
