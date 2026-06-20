import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireSession } from "@/lib/auth/requireSession";

/**
 * B3 — web reclassification of downtime episodes.
 *
 * The edge/operator capture path (/api/ingest/reason) is machine-authenticated and owns
 * the live flow. This route is the SESSION-authenticated, after-the-fact path: a supervisor
 * opens the downtime page, picks a real reason for an UNCLASSIFIED (or wrong) episode, and we
 * update the ReasonEntry — stamping classifiedBy/At/Via so the change is accountable.
 *
 *   GET  → active downtime reason options for the picker (any org member).
 *   POST → { reasonEntryId, reasonCode, categoryId?, reasonText? } reclassify one episode.
 *
 * Note: this updates classification only (reasonCode/label/text). Timing (durationSeconds,
 * episodeEndTs, capturedAt) is owned by /api/ingest/event and is never touched here — same
 * rule as the edge reason ingest.
 */

const bad = (status: number, error: string) => NextResponse.json({ ok: false, error }, { status });

export async function GET() {
  const session = await requireSession();
  if (!session) return bad(401, "Unauthorized");

  const categories = await prisma.reasonCatalogCategory.findMany({
    where: { orgId: session.orgId, kind: "downtime", active: true },
    include: {
      items: {
        where: { active: true },
        orderBy: [{ sortOrder: "asc" }, { reasonCode: "asc" }],
        select: { id: true, name: true, reasonCode: true },
      },
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });

  return NextResponse.json({
    ok: true,
    categories: categories.map((c) => ({
      id: c.id,
      name: c.name,
      items: c.items.map((it) => ({ id: it.id, name: it.name, reasonCode: it.reasonCode })),
    })),
  });
}

export async function POST(req: Request) {
  const session = await requireSession();
  if (!session) return bad(401, "Unauthorized");
  const { orgId, userId } = session;

  const body = await req.json().catch(() => null);
  const reasonEntryId = body?.reasonEntryId != null ? String(body.reasonEntryId).trim() : "";
  const reasonCodeRaw = body?.reasonCode != null ? String(body.reasonCode).trim() : "";
  const categoryId = body?.categoryId != null ? String(body.categoryId).trim() : null;
  let reasonText = body?.reasonText != null ? String(body.reasonText).trim() : null;

  if (!reasonEntryId) return bad(400, "Missing reasonEntryId");
  if (!reasonCodeRaw) return bad(400, "Missing reasonCode");

  // The episode must belong to the caller's org and be a downtime row.
  const existing = await prisma.reasonEntry.findFirst({
    where: { id: reasonEntryId, orgId, kind: "downtime" },
    select: { id: true },
  });
  if (!existing) return bad(404, "Downtime episode not found");

  let reasonCode = reasonCodeRaw.toUpperCase();

  // Resolve the human label + canonical composite code from the catalog (same rules as
  // /api/ingest/reason): direct match on full code, else (digits + categoryId) → suffix lookup.
  let resolvedLabel: string | null = null;
  let catalogItem = await prisma.reasonCatalogItem.findFirst({
    where: { orgId, reasonCode },
    select: { reasonCode: true, name: true, category: { select: { name: true } } },
  });
  if (!catalogItem && categoryId && /^\d+$/.test(reasonCodeRaw)) {
    catalogItem = await prisma.reasonCatalogItem.findFirst({
      where: { orgId, categoryId, codeSuffix: reasonCodeRaw },
      select: { reasonCode: true, name: true, category: { select: { name: true } } },
    });
    if (catalogItem) reasonCode = catalogItem.reasonCode.toUpperCase();
  }
  if (catalogItem) {
    resolvedLabel = `${catalogItem.category.name} > ${catalogItem.name}`;
  }

  // OTHER requires free text; any other code must not carry free text.
  if (reasonCode === "OTHER") {
    if (!reasonText || reasonText.length < 2) return bad(400, "reasonText required when reasonCode=OTHER");
  } else {
    reasonText = null;
  }

  const updated = await prisma.reasonEntry.update({
    where: { id: reasonEntryId },
    data: {
      reasonCode,
      reasonLabel: resolvedLabel,
      reasonText,
      classifiedBy: userId,
      classifiedAt: new Date(),
      classifiedVia: "web",
    },
    select: { id: true, reasonCode: true, reasonLabel: true },
  });

  return NextResponse.json({ ok: true, reasonEntry: updated });
}
