import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOrgAdminSession } from "@/lib/auth/requireOrgAdminSession";
import { bumpOrgSettingsVersion, composeReasonCode, isNumericSuffix } from "@/lib/reasonCatalogDb";
import { z } from "zod";

const patchSchema = z.object({
  name: z.string().trim().min(1).max(500).optional(),
  codeSuffix: z.string().trim().min(1).max(32).optional(),
  sortOrder: z.number().int().optional(),
  active: z.boolean().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ itemId: string }> }
) {
  const auth = await requireOrgAdminSession();
  if (!auth.ok) return auth.response;

  const { itemId } = await params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid body", issues: parsed.error.flatten() }, { status: 400 });
  }

  const existing = await prisma.reasonCatalogItem.findFirst({
    where: { id: itemId, orgId: auth.session.orgId },
    include: { category: true },
  });
  if (!existing) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

  const nextSuffix = parsed.data.codeSuffix ?? existing.codeSuffix;
  if (parsed.data.codeSuffix !== undefined && !isNumericSuffix(nextSuffix)) {
    return NextResponse.json({ ok: false, error: "codeSuffix must be digits only" }, { status: 400 });
  }

  const reasonCode = composeReasonCode(existing.category.codePrefix, nextSuffix);
  if (reasonCode !== existing.reasonCode) {
    const conflict = await prisma.reasonCatalogItem.findFirst({
      where: { orgId: auth.session.orgId, reasonCode, NOT: { id: itemId } },
      select: { id: true },
    });
    if (conflict) {
      return NextResponse.json({ ok: false, error: "Duplicate reasonCode for this organization" }, { status: 409 });
    }
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.reasonCatalogItem.update({
        where: { id: itemId },
        data: {
          ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
          ...(parsed.data.codeSuffix !== undefined ? { codeSuffix: nextSuffix, reasonCode } : {}),
          ...(parsed.data.sortOrder !== undefined ? { sortOrder: parsed.data.sortOrder } : {}),
          ...(parsed.data.active !== undefined ? { active: parsed.data.active } : {}),
        },
      });
      await bumpOrgSettingsVersion(tx, auth.session.orgId, auth.session.userId);
    });

    const updated = await prisma.reasonCatalogItem.findUnique({ where: { id: itemId } });
    return NextResponse.json({ ok: true, item: updated });
  } catch (e) {
    console.error("[reason-catalog item PATCH]", e);
    return NextResponse.json({ ok: false, error: "Update failed" }, { status: 500 });
  }
}
