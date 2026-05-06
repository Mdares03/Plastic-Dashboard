import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOrgAdminSession } from "@/lib/auth/requireOrgAdminSession";
import { bumpOrgSettingsVersion } from "@/lib/reasonCatalogDb";
import { z } from "zod";

const PREFIX_RE = /^[A-Za-z][A-Za-z0-9-]*$/;

const bodySchema = z.object({
  kind: z.enum(["downtime", "scrap"]),
  name: z.string().trim().min(1).max(200),
  codePrefix: z
    .string()
    .trim()
    .min(1)
    .max(32)
    .transform((s) => s.toUpperCase()),
});

export async function POST(req: Request) {
  const auth = await requireOrgAdminSession();
  if (!auth.ok) return auth.response;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ ok: false, error: "Invalid body", issues: parsed.error.flatten() }, { status: 400 });
  }
  const { kind, name, codePrefix } = parsed.data;
  if (!PREFIX_RE.test(codePrefix)) {
    return NextResponse.json(
      { ok: false, error: "codePrefix must start with a letter; letters, digits, hyphen allowed." },
      { status: 400 }
    );
  }

  try {
    const row = await prisma.$transaction(async (tx) => {
      const last = await tx.reasonCatalogCategory.findFirst({
        where: { orgId: auth.session.orgId, kind },
        orderBy: { sortOrder: "desc" },
        select: { sortOrder: true },
      });
      const sortOrder = (last?.sortOrder ?? -1) + 1;

      const created = await tx.reasonCatalogCategory.create({
        data: {
          orgId: auth.session.orgId,
          kind,
          name,
          codePrefix,
          sortOrder,
          active: true,
        },
      });
      await bumpOrgSettingsVersion(tx, auth.session.orgId, auth.session.userId);
      return created;
    });

    return NextResponse.json({ ok: true, category: row });
  } catch (e) {
    console.error("[reason-catalog categories POST]", e);
    return NextResponse.json({ ok: false, error: "Create failed" }, { status: 500 });
  }
}
