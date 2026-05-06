import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/requireSession";
import { flattenReasonCatalog, normalizeReasonCatalog, type ReasonCatalogKind } from "@/lib/reasonCatalog";
import { effectiveReasonCatalogForOrg, loadReasonCatalogFromDb } from "@/lib/reasonCatalogDb";

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
    select: { defaultsJson: true, version: true },
  });
  const version = orgSettings?.version ?? 1;
  const defaultsJson = orgSettings?.defaultsJson ?? null;

  const fromDb = await loadReasonCatalogFromDb(session.orgId, version);
  const catalog = await effectiveReasonCatalogForOrg(session.orgId, defaultsJson, version);

  const defs =
    defaultsJson && typeof defaultsJson === "object" && !Array.isArray(defaultsJson)
      ? (defaultsJson as Record<string, unknown>)
      : {};
  const legacyJson = normalizeReasonCatalog(defs.reasonCatalog ?? defs.reasonCatalogData);

  let source: "db" | "legacy" | "fallback";
  if (fromDb) source = "db";
  else if (legacyJson) source = "legacy";
  else source = "fallback";

  const rows = flattenReasonCatalog(catalog, kind, { activeOnly: true });

  return NextResponse.json({
    ok: true,
    source,
    kind,
    catalogVersion: catalog.version,
    categories: catalog[kind],
    rows,
  });
}
