import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  detailEffectiveReasonCode,
  type ReasonCatalog,
  type ReasonCatalogCategory,
  type ReasonCatalogDetail,
} from "@/lib/reasonCatalog";
import { effectiveReasonCatalogForOrg } from "@/lib/reasonCatalogDb";

type Mode = "--dry" | "--apply";

type DowntimeRow = {
  id: string;
  machineId: string;
  reasonCode: string;
  reasonLabel: string | null;
  reasonText: string | null;
  meta: Prisma.JsonValue;
  schemaVersion: number;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeText(value: unknown) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function extractNumericSuffix(value: unknown): number | null {
  const text = String(value ?? "").trim();
  const match = text.match(/(\d{1,3})$/);
  if (!match) return null;
  const parsed = Number(match[1]);
  if (!Number.isInteger(parsed)) return null;
  return parsed;
}

function splitNumericReasonLabel(value: string | null): { categoryLabel: string; digits: number } | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const match = text.match(/^(.+?)\s*>\s*(\d{1,3})$/);
  if (!match) return null;
  const digits = Number(match[2]);
  if (!Number.isInteger(digits)) return null;
  return { categoryLabel: match[1].trim(), digits };
}

function parseArgs(argv: string[]): { orgId: string; mode: Mode } {
  const orgId = (argv[0] ?? "").trim();
  const modeRaw = (argv[1] ?? "--dry").trim();
  if (!orgId) {
    throw new Error("usage: npx tsx scripts/backfill-downtime-reasons.ts <orgId> --dry|--apply");
  }
  if (modeRaw !== "--dry" && modeRaw !== "--apply") {
    throw new Error("Second arg must be --dry or --apply");
  }
  return { orgId, mode: modeRaw };
}

async function loadCatalog(orgId: string): Promise<ReasonCatalog> {
  const settings = await prisma.orgSettings.findUnique({
    where: { orgId },
    select: { defaultsJson: true, version: true },
  });

  return effectiveReasonCatalogForOrg(
    orgId,
    settings?.defaultsJson ?? null,
    settings?.version ?? 1
  );
}

function findCategory(catalog: ReasonCatalog, categoryLabel: string): ReasonCatalogCategory | null {
  const needle = normalizeText(categoryLabel);
  if (!needle) return null;
  for (const category of catalog.downtime) {
    if (normalizeText(category.label) === needle) return category;
  }
  return null;
}

function findDetailByDigits(category: ReasonCatalogCategory, digits: number): ReasonCatalogDetail | null {
  const byCode = category.details.find((detail) => {
    const suffix = extractNumericSuffix(detail.reasonCode ?? "");
    return suffix != null && suffix === digits;
  });
  if (byCode) return byCode;

  const byId = category.details.find((detail) => {
    const idDigits = extractNumericSuffix(detail.id);
    return idDigits != null && idDigits === digits;
  });
  if (byId) return byId;

  return null;
}

function isLikelyBroken(row: DowntimeRow) {
  const numericLabel = splitNumericReasonLabel(row.reasonLabel);
  if (numericLabel) return true;

  const code = String(row.reasonCode ?? "").trim();
  if (/^\d{1,3}$/.test(code)) return true;

  return false;
}

function nextMetaValue(params: {
  current: Prisma.JsonValue;
  category: ReasonCatalogCategory;
  detail: ReasonCatalogDetail;
  reasonLabel: string;
  reasonCode: string;
  schemaVersion: number;
}): Prisma.InputJsonValue {
  const existingMeta = isPlainObject(params.current)
    ? ({ ...params.current } as Record<string, unknown>)
    : {};

  const existingReason = isPlainObject(existingMeta.reason)
    ? ({ ...existingMeta.reason } as Record<string, unknown>)
    : {};

  existingMeta.reason = {
    ...existingReason,
    type: "downtime",
    categoryId: params.category.id,
    categoryLabel: params.category.label,
    detailId: params.detail.id,
    detailLabel: params.detail.label,
    reasonText: params.reasonLabel,
    catalogVersion: Math.max(1, Math.trunc(params.schemaVersion || 1)),
  };
  existingMeta.backfilled = true;

  return existingMeta as Prisma.InputJsonValue;
}

async function main() {
  const { orgId, mode } = parseArgs(process.argv.slice(2));
  const catalog = await loadCatalog(orgId);

  const rows: DowntimeRow[] = await prisma.reasonEntry.findMany({
    where: { orgId, kind: "downtime" },
    select: {
      id: true,
      machineId: true,
      reasonCode: true,
      reasonLabel: true,
      reasonText: true,
      meta: true,
      schemaVersion: true,
    },
  });

  let fixable = 0;
  let skipped = 0;
  let noMatch = 0;
  let applied = 0;

  for (const row of rows) {
    if (!isLikelyBroken(row)) {
      skipped += 1;
      continue;
    }

    const numericLabel = splitNumericReasonLabel(row.reasonLabel);
    if (!numericLabel) {
      noMatch += 1;
      continue;
    }

    const category = findCategory(catalog, numericLabel.categoryLabel);
    if (!category) {
      noMatch += 1;
      continue;
    }

    const digits = extractNumericSuffix(row.reasonCode) ?? numericLabel.digits;
    if (digits == null) {
      noMatch += 1;
      continue;
    }

    const detail = findDetailByDigits(category, digits);
    if (!detail) {
      noMatch += 1;
      continue;
    }

    const nextReasonCode = detailEffectiveReasonCode(category, detail);
    const nextReasonLabel = `${category.label} > ${detail.label}`;

    const didChange =
      String(row.reasonCode).toUpperCase() !== String(nextReasonCode).toUpperCase() ||
      String(row.reasonLabel ?? "") !== nextReasonLabel;

    if (!didChange) {
      skipped += 1;
      continue;
    }

    fixable += 1;

    console.log(
      `[${row.id}] "${row.reasonLabel ?? ""}" (${row.reasonCode}) -> "${nextReasonLabel}" (${nextReasonCode})`
    );

    if (mode === "--apply") {
      await prisma.reasonEntry.update({
        where: { id: row.id },
        data: {
          reasonCode: nextReasonCode,
          reasonLabel: nextReasonLabel,
          reasonText:
            row.reasonText == null || row.reasonText.trim() === "" || row.reasonText === row.reasonLabel
              ? nextReasonLabel
              : row.reasonText,
          meta: nextMetaValue({
            current: row.meta,
            category,
            detail,
            reasonLabel: nextReasonLabel,
            reasonCode: nextReasonCode,
            schemaVersion: row.schemaVersion,
          }),
        },
      });
      applied += 1;
    }
  }

  console.log(
    `\nfixable: ${fixable}  no-match: ${noMatch}  skipped: ${skipped}  applied: ${applied}  total: ${rows.length}`
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
