import { NextResponse } from "next/server";
import { requireOrgAdminSession } from "@/lib/auth/requireOrgAdminSession";
import { buildOnboardingWorkbook } from "@/lib/onboarding/workbook";

/** Download the onboarding config template as an Excel workbook (item 8). Admin/owner only. */
export async function GET() {
  const auth = await requireOrgAdminSession();
  if (!auth.ok) return auth.response;

  const buffer = buildOnboardingWorkbook();
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="maliountech-onboarding-template.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}
