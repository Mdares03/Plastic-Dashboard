import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireOrgAdminSession } from "@/lib/auth/requireOrgAdminSession";

/** Full tree for Control Tower (includes inactive rows). */
export async function GET() {
  const auth = await requireOrgAdminSession();
  if (!auth.ok) return auth.response;

  const orgSettings = await prisma.orgSettings.findUnique({
    where: { orgId: auth.session.orgId },
    select: { version: true },
  });

  const categories = await prisma.reasonCatalogCategory.findMany({
    where: { orgId: auth.session.orgId },
    include: {
      items: { orderBy: [{ sortOrder: "asc" }, { reasonCode: "asc" }] },
    },
    orderBy: [{ kind: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
  });

  return NextResponse.json({
    ok: true,
    catalogVersion: orgSettings?.version ?? 1,
    categories: categories.map((c) => ({
      id: c.id,
      kind: c.kind,
      name: c.name,
      codePrefix: c.codePrefix,
      sortOrder: c.sortOrder,
      active: c.active,
      items: c.items.map((it) => ({
        id: it.id,
        name: it.name,
        codeSuffix: it.codeSuffix,
        reasonCode: it.reasonCode,
        sortOrder: it.sortOrder,
        active: it.active,
      })),
    })),
  });
}
