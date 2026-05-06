import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { ReasonCatalog, ReasonCatalogCategory, ReasonCatalogDetail } from "@/lib/reasonCatalog";
import { normalizeReasonCatalog } from "@/lib/reasonCatalog";
import { loadFallbackReasonCatalog } from "@/lib/reasonCatalogFallback";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/**
 * Full printed code from category prefix + operator numeric suffix (or suffix digits from seed).
 * Downtime-style keys use a hyphen before the numeric part (e.g. DTPRC-01); short scrap-style
 * prefixes (e.g. MX) concatenate without hyphen (MX001).
 */
export function composeReasonCode(prefix: string, suffix: string): string {
  const p = String(prefix ?? "").trim().toUpperCase();
  const s = String(suffix ?? "").trim();
  if (/^\d+$/.test(s) && p.length >= 3) {
    return `${p}-${s}`.toUpperCase();
  }
  return `${p}${s}`.toUpperCase();
}

export function isNumericSuffix(value: string): boolean {
  return /^\d+$/.test(String(value ?? "").trim());
}

function mapKind(kind: string): "downtime" | "scrap" | null {
  const k = String(kind).toLowerCase();
  if (k === "downtime" || k === "scrap") return k;
  return null;
}

/**
 * Load catalog from Postgres tables. Returns null if org has no catalog rows yet.
 * Includes inactive rows for historical label resolution (same as prior JSON behavior).
 */
export async function loadReasonCatalogFromDb(
  orgId: string,
  catalogVersion: number
): Promise<ReasonCatalog | null> {
  const rows = await prisma.reasonCatalogCategory.findMany({
    where: { orgId },
    include: {
      items: { orderBy: { sortOrder: "asc" } },
    },
    orderBy: [{ kind: "asc" }, { sortOrder: "asc" }],
  });
  if (!rows.length) return null;

  const downtime: ReasonCatalogCategory[] = [];
  const scrap: ReasonCatalogCategory[] = [];

  for (const cat of rows) {
    const k = mapKind(cat.kind);
    if (!k) continue;
    const details: ReasonCatalogDetail[] = cat.items.map((it) => ({
      id: it.id,
      label: it.name,
      reasonCode: it.reasonCode,
      active: it.active,
    }));
    const bucket: ReasonCatalogCategory = {
      id: cat.id,
      label: cat.name,
      details,
    };
    if (k === "downtime") downtime.push(bucket);
    else scrap.push(bucket);
  }

  if (!downtime.length && !scrap.length) return null;
  return { version: Math.max(1, catalogVersion), downtime, scrap };
}

/** DB first, then legacy JSON in defaults, then file fallback. */
export async function effectiveReasonCatalogForOrg(
  orgId: string,
  defaultsJson: unknown,
  settingsVersion: number
): Promise<ReasonCatalog> {
  const fromDb = await loadReasonCatalogFromDb(orgId, settingsVersion);
  if (fromDb) return fromDb;

  const defs = isPlainObject(defaultsJson) ? defaultsJson : {};
  const fromJson = normalizeReasonCatalog(defs.reasonCatalog ?? defs.reasonCatalogData);
  if (fromJson) return fromJson;

  return loadFallbackReasonCatalog();
}

export async function bumpOrgSettingsVersion(tx: Prisma.TransactionClient, orgId: string, userId: string) {
  await tx.orgSettings.update({
    where: { orgId },
    data: { version: { increment: 1 }, updatedBy: userId },
  });
}
