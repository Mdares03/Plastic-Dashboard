import { readFile } from "fs/promises";
import path from "path";

type AnyRecord = Record<string, unknown>;

export type ReasonCatalogKind = "downtime" | "scrap";

export type ReasonCatalogDetail = {
  id: string;
  label: string;
};

export type ReasonCatalogCategory = {
  id: string;
  label: string;
  details: ReasonCatalogDetail[];
};

export type ReasonCatalog = {
  version: number;
  downtime: ReasonCatalogCategory[];
  scrap: ReasonCatalogCategory[];
};

function isPlainObject(value: unknown): value is AnyRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function canonicalId(input: unknown, fallback = "item") {
  const text = String(input ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return text || fallback;
}

function buildReasonCode(categoryId: string, detailId: string) {
  return `${canonicalId(categoryId)}__${canonicalId(detailId)}`.toUpperCase();
}

function toCategory(raw: unknown): ReasonCatalogCategory | null {
  if (!isPlainObject(raw)) return null;
  const labelRaw = String(raw.label ?? "").trim();
  if (!labelRaw) return null;
  const idRaw = String(raw.id ?? "").trim() || canonicalId(labelRaw, "category");
  const detailsRaw =
    (Array.isArray(raw.details) && raw.details) ||
    (Array.isArray(raw.children) && raw.children) ||
    (Array.isArray(raw.items) && raw.items) ||
    [];

  const details: ReasonCatalogDetail[] = [];
  for (const detailRaw of detailsRaw) {
    if (!isPlainObject(detailRaw)) continue;
    const detailLabel = String(detailRaw.label ?? "").trim();
    if (!detailLabel) continue;
    const detailId = String(detailRaw.id ?? "").trim() || canonicalId(detailLabel, "detail");
    details.push({ id: detailId, label: detailLabel });
  }

  if (!details.length) return null;
  return { id: idRaw, label: labelRaw, details };
}

function normalizeKind(raw: unknown): ReasonCatalogCategory[] {
  const arr =
    (Array.isArray(raw) && raw) ||
    (isPlainObject(raw) && Array.isArray(raw.categories) && raw.categories) ||
    [];
  const out: ReasonCatalogCategory[] = [];
  for (const candidate of arr) {
    const parsed = toCategory(candidate);
    if (parsed) out.push(parsed);
  }
  return out;
}

export function normalizeReasonCatalog(raw: unknown): ReasonCatalog | null {
  if (!isPlainObject(raw)) return null;
  const downtime = normalizeKind(raw.downtime);
  const scrap = normalizeKind(raw.scrap);
  if (!downtime.length && !scrap.length) return null;
  const versionNum = Number(raw.version);
  const version = Number.isFinite(versionNum) ? Math.max(1, Math.trunc(versionNum)) : 1;
  return {
    version,
    downtime,
    scrap,
  };
}

export function parseReasonCatalogMarkdown(markdown: string): ReasonCatalog {
  const lines = markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const buckets: Record<ReasonCatalogKind, Map<string, ReasonCatalogCategory>> = {
    downtime: new Map(),
    scrap: new Map(),
  };
  let activeKind: ReasonCatalogKind = "downtime";

  for (const line of lines) {
    const lowered = line.toLowerCase();
    if (lowered === "downtime") {
      activeKind = "downtime";
      continue;
    }
    if (lowered === "scrap") {
      activeKind = "scrap";
      continue;
    }

    const slash = line.indexOf("/");
    if (slash < 1 || slash === line.length - 1) continue;

    const categoryLabel = line.slice(0, slash).trim();
    const detailLabel = line.slice(slash + 1).trim();
    if (!categoryLabel || !detailLabel) continue;

    const categoryId = canonicalId(categoryLabel, "category");
    const detailId = canonicalId(detailLabel, "detail");

    const existing =
      buckets[activeKind].get(categoryId) ?? {
        id: categoryId,
        label: categoryLabel,
        details: [] as ReasonCatalogDetail[],
      };
    if (!existing.details.some((d) => d.id === detailId)) {
      existing.details.push({ id: detailId, label: detailLabel });
    }
    buckets[activeKind].set(categoryId, existing);
  }

  return {
    version: 1,
    downtime: [...buckets.downtime.values()],
    scrap: [...buckets.scrap.values()],
  };
}

let catalogPromise: Promise<ReasonCatalog> | null = null;

export async function loadFallbackReasonCatalog() {
  if (!catalogPromise) {
    catalogPromise = readFile(path.join(process.cwd(), "downtime_menu.md"), "utf8")
      .then((raw) => parseReasonCatalogMarkdown(raw))
      .catch(() => ({ version: 1, downtime: [], scrap: [] }));
  }
  return catalogPromise;
}

export function flattenReasonCatalog(catalog: ReasonCatalog, kind: ReasonCatalogKind) {
  return (catalog[kind] ?? []).flatMap((category) =>
    category.details.map((detail) => ({
      kind,
      categoryId: category.id,
      categoryLabel: category.label,
      detailId: detail.id,
      detailLabel: detail.label,
      reasonCode: buildReasonCode(category.id, detail.id),
      reasonLabel: `${category.label} > ${detail.label}`,
    }))
  );
}

export function findCatalogReason(
  catalog: ReasonCatalog | null | undefined,
  kind: ReasonCatalogKind,
  categoryId: unknown,
  detailId: unknown
) {
  if (!catalog) return null;
  const catId = canonicalId(categoryId, "");
  const detId = canonicalId(detailId, "");
  if (!catId || !detId) return null;
  const category = (catalog[kind] ?? []).find((c) => canonicalId(c.id, "") === catId);
  if (!category) return null;
  const detail = category.details.find((d) => canonicalId(d.id, "") === detId);
  if (!detail) return null;
  return {
    categoryId: category.id,
    categoryLabel: category.label,
    detailId: detail.id,
    detailLabel: detail.label,
    reasonCode: buildReasonCode(category.id, detail.id),
    reasonLabel: `${category.label} > ${detail.label}`,
  };
}

export function toReasonCode(categoryId: unknown, detailId: unknown) {
  const cat = canonicalId(categoryId, "");
  const det = canonicalId(detailId, "");
  if (!cat || !det) return null;
  return buildReasonCode(cat, det);
}
