import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOrgAdminSession } from "@/lib/auth/requireOrgAdminSession";
import { bumpOrgSettingsVersion, composeReasonCode } from "@/lib/reasonCatalogDb";
import { z } from "zod";

const PREFIX_RE = /^[A-Za-z][A-Za-z0-9-]*$/;

const patchSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  codePrefix: z
    .string()
    .trim()
    .min(1)
    .max(32)
    .transform((s) => s.toUpperCase())
    .optional(),
  sortOrder: z.number().int().optional(),
  active: z.boolean().optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ categoryId: string }> }
) {
  const auth = await requireOrgAdminSession();
  if (!auth.ok) return auth.response;

  const { categoryId } = await params;
  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid body", issues: parsed.error.flatten() }, { status: 400 });
  }

  const existing = await prisma.reasonCatalogCategory.findFirst({
    where: { id: categoryId, orgId: auth.session.orgId },
    include: { items: true },
  });
  if (!existing) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

  const nextPrefix = parsed.data.codePrefix ?? existing.codePrefix;
  if (parsed.data.codePrefix !== undefined && !PREFIX_RE.test(nextPrefix)) {
    return NextResponse.json(
      { ok: false, error: "codePrefix must start with a letter; letters, digits, hyphen allowed." },
      { status: 400 }
    );
  }

  if (parsed.data.codePrefix !== undefined && parsed.data.codePrefix !== existing.codePrefix) {
    const proposed = new Set<string>();
    for (const it of existing.items) {
      proposed.add(composeReasonCode(nextPrefix, it.codeSuffix));
    }
    const codes = [...proposed];
    const conflicts = await prisma.reasonCatalogItem.findMany({
      where: {
        orgId: auth.session.orgId,
        reasonCode: { in: codes },
        NOT: { categoryId: existing.id },
      },
      select: { reasonCode: true },
    });
    if (conflicts.length) {
      return NextResponse.json(
        { ok: false, error: "Prefix change would duplicate codes", conflicts: conflicts.map((c) => c.reasonCode) },
        { status: 409 }
      );
    }
  }

  try {
    await prisma.$transaction(async (tx) => {
      await tx.reasonCatalogCategory.update({
        where: { id: categoryId },
        data: {
          ...(parsed.data.name !== undefined ? { name: parsed.data.name } : {}),
          ...(parsed.data.codePrefix !== undefined ? { codePrefix: parsed.data.codePrefix } : {}),
          ...(parsed.data.sortOrder !== undefined ? { sortOrder: parsed.data.sortOrder } : {}),
          ...(parsed.data.active !== undefined ? { active: parsed.data.active } : {}),
        },
      });

      if (parsed.data.codePrefix !== undefined && parsed.data.codePrefix !== existing.codePrefix) {
        for (const it of existing.items) {
          const reasonCode = composeReasonCode(nextPrefix, it.codeSuffix);
          await tx.reasonCatalogItem.update({
            where: { id: it.id },
            data: { reasonCode },
          });
        }
      }

      await bumpOrgSettingsVersion(tx, auth.session.orgId, auth.session.userId);
    });

    const updated = await prisma.reasonCatalogCategory.findUnique({
      where: { id: categoryId },
      include: { items: { orderBy: [{ sortOrder: "asc" }, { reasonCode: "asc" }] } },
    });

    return NextResponse.json({ ok: true, category: updated });
  } catch (e) {
    console.error("[reason-catalog category PATCH]", e);
    return NextResponse.json({ ok: false, error: "Update failed" }, { status: 500 });
  }
}
