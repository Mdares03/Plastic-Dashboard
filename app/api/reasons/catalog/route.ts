import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/requireSession";
import {
  flattenReasonCatalog,
  loadFallbackReasonCatalog,
  normalizeReasonCatalog,
  type ReasonCatalogKind,
} from "@/lib/reasonCatalog";

function asKind(value: string | null): ReasonCatalogKind | null {
  const kind = String(value ?? "").toLowerCase();
  if (kind === "downtime" || kind === "scrap") return kind;
  return null;
}

export async function GET(req: Request) {
  const session = await requireSession();
  if (!session) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const kind = asKind(url.searchParams.get("kind"));
  if (!kind) {
    return NextResponse.json({ ok: false, error: "Invalid kind (downtime|scrap)" }, { status: 400 });
  }

  const orgSettings = await prisma.orgSettings.findUnique({
    where: { orgId: session.orgId },
    select: { defaultsJson: true },
  });
  const defaultsJson =
    orgSettings?.defaultsJson && typeof orgSettings.defaultsJson === "object" && !Array.isArray(orgSettings.defaultsJson)
      ? (orgSettings.defaultsJson as Record<string, unknown>)
      : {};
  const settingsCatalog = normalizeReasonCatalog(defaultsJson.reasonCatalog ?? defaultsJson.reasonCatalogData);
  const fallbackCatalog = await loadFallbackReasonCatalog();
  const catalog = settingsCatalog ?? fallbackCatalog;
  const rows = flattenReasonCatalog(catalog, kind);

  return NextResponse.json({
    ok: true,
    source: settingsCatalog ? "settings" : "fallback",
    kind,
    catalogVersion: catalog.version,
    categories: catalog[kind],
    rows,
  });
}
