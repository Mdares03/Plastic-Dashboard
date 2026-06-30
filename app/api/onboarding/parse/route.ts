import { NextResponse } from "next/server";
import { requireOrgAdminSession } from "@/lib/auth/requireOrgAdminSession";
import { parseOnboardingWorkbook } from "@/lib/onboarding/workbook";
import { onboardingConfigSchema } from "@/lib/onboarding/schema";

/**
 * Parse an uploaded onboarding template (.xlsx, or .json for power users) into
 * the shared config shape and hand it back to the wizard to review before
 * provisioning. Parse-only — it never writes; the wizard submits to /import.
 * Admin/owner only.
 */
export async function POST(req: Request) {
  const auth = await requireOrgAdminSession();
  if (!auth.ok) return auth.response;

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof Blob)) {
    return NextResponse.json({ ok: false, error: "No file uploaded" }, { status: 400 });
  }

  const name = (file instanceof File ? file.name : "").toLowerCase();
  const buf = Buffer.from(await file.arrayBuffer());

  let raw: unknown;
  try {
    if (name.endsWith(".json")) {
      raw = JSON.parse(buf.toString("utf8"));
    } else {
      // Default to spreadsheet parsing (.xlsx/.xls/.csv all handled by SheetJS).
      raw = parseOnboardingWorkbook(buf);
    }
  } catch {
    return NextResponse.json(
      { ok: false, error: "Could not read that file — use the downloaded template (.xlsx or .json)." },
      { status: 400 }
    );
  }

  // Surface validation issues now, but still return the parsed config so the
  // wizard can pre-fill and let the user fix it in the form.
  const parsed = onboardingConfigSchema.safeParse(raw);
  return NextResponse.json({
    ok: true,
    config: raw,
    valid: parsed.success,
    issues: parsed.success ? [] : parsed.error.issues,
  });
}
