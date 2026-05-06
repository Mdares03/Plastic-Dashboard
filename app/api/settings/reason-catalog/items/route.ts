import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOrgAdminSession } from "@/lib/auth/requireOrgAdminSession";
import { bumpOrgSettingsVersion, composeReasonCode, isNumericSuffix } from "@/lib/reasonCatalogDb";
import { z } from "zod";

const bodySchema = z.object({
  categoryId: z.string().uuid(),
  codeSuffix: z.string().trim().min(1).max(32),
  name: z.string().trim().min(1).max(500),
  sortOrder: z.number().int().optional(),
});

export async function POST(req: Request) {
  const auth = await requireOrgAdminSession();
  if (!auth.ok) return auth.response;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid body", issues: parsed.error.flatten() }, { status: 400 });
  }

  const { categoryId, codeSuffix, name, sortOrder } = parsed.data;
  if (!isNumericSuffix(codeSuffix)) {
    return NextResponse.json({ ok: false, error: "codeSuffix must be digits only" }, { status: 400 });
  }

  const category = await prisma.reasonCatalogCategory.findFirst({
    where: { id: categoryId, orgId: auth.session.orgId },
  });
  if (!category) return NextResponse.json({ ok: false, error: "Category not found" }, { status: 404 });

  const reasonCode = composeReasonCode(category.codePrefix, codeSuffix);

  try {
    const row = await prisma.$transaction(async (tx) => {
      let nextOrder = sortOrder;
      if (nextOrder === undefined) {
        const last = await tx.reasonCatalogItem.findFirst({
          where: { categoryId },
          orderBy: { sortOrder: "desc" },
          select: { sortOrder: true },
        });
        nextOrder = (last?.sortOrder ?? -1) + 1;
      }

      const created = await tx.reasonCatalogItem.create({
        data: {
          orgId: auth.session.orgId,
          categoryId,
          name,
          codeSuffix,
          reasonCode,
          sortOrder: nextOrder,
          active: true,
        },
      });
      await bumpOrgSettingsVersion(tx, auth.session.orgId, auth.session.userId);
      return created;
    });

    return NextResponse.json({ ok: true, item: row });
  } catch (e: unknown) {
    const code = typeof e === "object" && e && "code" in e ? (e as { code: string }).code : "";
    if (code === "P2002") {
      return NextResponse.json({ ok: false, error: "Duplicate reasonCode for this organization" }, { status: 409 });
    }
    console.error("[reason-catalog items POST]", e);
    return NextResponse.json({ ok: false, error: "Create failed" }, { status: 500 });
  }
}
