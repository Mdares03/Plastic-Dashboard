#!/usr/bin/env node
/**
 * Load downtime + scrap catalogs from Excel under ./reasons/ into Postgres.
 *
 *   npx dotenv -e .env -- node scripts/seed-reason-catalog-from-xlsx.mjs --org-id <uuid>
 *   npx dotenv -e .env -- node scripts/seed-reason-catalog-from-xlsx.mjs --org-slug my-org --replace
 *
 * --dry-run   parse and print counts only
 * --replace   delete existing reason_catalog_* rows for the org before insert
 */

import { readFileSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import * as XLSX from "xlsx";
import { PrismaClient } from "@prisma/client";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");

const prisma = new PrismaClient();

function composeReasonCode(prefix, suffix) {
  const p = String(prefix ?? "").trim().toUpperCase();
  const s = String(suffix ?? "").trim();
  if (/^\d+$/.test(s) && p.length >= 3) {
    return `${p}-${s}`.toUpperCase();
  }
  return `${p}${s}`.toUpperCase();
}

function parseArgs(argv) {
  const out = {
    dryRun: false,
    replace: false,
    orgId: null,
    orgSlug: null,
    downtimePath: path.join(ROOT, "reasons", "Claves Tiempo Muerto.xlsx"),
    scrapPath: path.join(ROOT, "reasons", "Claves de Scrap.xlsx"),
  };

  for (let i = 0; i < argv.length; i += 1) {
    const t = argv[i];
    if (t === "--dry-run") out.dryRun = true;
    else if (t === "--replace") out.replace = true;
    else if (t === "--org-id") {
      out.orgId = argv[i + 1] || null;
      i += 1;
    } else if (t === "--org-slug") {
      out.orgSlug = argv[i + 1] || null;
      i += 1;
    } else if (t === "--downtime") {
      out.downtimePath = argv[i + 1] || out.downtimePath;
      i += 1;
    } else if (t === "--scrap") {
      out.scrapPath = argv[i + 1] || out.scrapPath;
      i += 1;
    } else {
      throw new Error(`Unknown arg: ${t}`);
    }
  }
  return out;
}

function readWorkbook(filePath) {
  if (!existsSync(filePath)) {
    throw new Error(`File not found: ${filePath}`);
  }
  const buf = readFileSync(filePath);
  return XLSX.read(buf, { type: "buffer" });
}

/** @returns {{ kind:'downtime', name:string, codePrefix:string, items: { suffix:string, name:string }[] }[]} */
function parseDowntimeXlsx(filePath) {
  const wb = readWorkbook(filePath);
  const data = XLSX.utils.sheet_to_json(wb.Sheets["Sheet1"], { header: 1, defval: "" });
  const headerRowIdx = 3;
  const header = data[headerRowIdx] || [];
  const cols = [];
  for (let c = 0; c < header.length; c += 1) {
    if (String(header[c] || "").trim()) cols.push(c);
  }

  const categoryByCol = {};
  cols.forEach((c) => {
    categoryByCol[c] = String(header[c]).trim();
  });

  const CODE = /^([A-Z0-9][A-Za-z0-9-]*)-(\d+)\s+(.*)$/;
  const rawItems = [];

  for (let r = headerRowIdx + 1; r < data.length; r += 1) {
    const row = data[r] || [];
    for (const c of cols) {
      const cell = String(row[c] ?? "").trim();
      if (!cell) continue;

      const m = cell.match(CODE);
      if (m) {
        rawItems.push({
          col: c,
          categoryLabel: categoryByCol[c],
          prefix: m[1].toUpperCase(),
          suffix: m[2],
          name: m[3].trim(),
          row: r,
        });
      } else if (cell.length > 2 && cell === cell.toUpperCase() && !/\d/.test(cell)) {
        categoryByCol[c] = cell;
      }
    }
  }

  /** @type {Map<string, { kind:'downtime', name:string, codePrefix:string, items: { suffix:string, name:string }[]}>} */
  const catMap = new Map();

  function catKey(categoryName, prefix) {
    return `${categoryName}\0${prefix}`;
  }

  for (const it of rawItems) {
    const key = catKey(it.categoryLabel, it.prefix);
    let bucket = catMap.get(key);
    if (!bucket) {
      bucket = { kind: "downtime", name: it.categoryLabel, codePrefix: it.prefix, items: [] };
      catMap.set(key, bucket);
    }
    bucket.items.push({ suffix: it.suffix, name: it.name });
  }

  /** Dedupe suffix per category (keep first description). */
  for (const b of catMap.values()) {
    const seen = new Map();
    const next = [];
    for (const row of b.items) {
      if (seen.has(row.suffix)) continue;
      seen.set(row.suffix, true);
      next.push(row);
    }
    b.items = next.sort((a, b) => Number(a.suffix) - Number(b.suffix));
  }

  return [...catMap.values()];
}

function parseScrapXlsx(filePath) {
  const wb = readWorkbook(filePath);
  const data = XLSX.utils.sheet_to_json(wb.Sheets["Sheet1"], { header: 1, defval: "" });
  /** @type { { suffix:string, name:string, full:string }[] } */
  const rows = [];
  for (let r = 0; r < data.length; r += 1) {
    const clave = String(data[r][0] ?? "").trim();
    const desc = String(data[r][1] ?? "").trim().replace(/\s+/g, " ");
    if (!clave || /^clave/i.test(clave)) continue;
    if (!desc || /Rev\.?\s*[A-Z]/i.test(desc)) continue;
    const m = clave.toUpperCase().match(/^([A-Z]+)(\d+)$/);
    if (!m) {
      console.warn(`[scrap] skip row ${r}:`, clave);
      continue;
    }
    rows.push({
      full: `${m[1]}${m[2]}`,
      suffix: m[2],
      name: desc,
    });
  }

  /** Single category when all MX… */
  const prefixes = new Set(rows.map((x) => x.full.replace(/\d+$/, "")));
  if (prefixes.size !== 1) {
    console.warn("[scrap] multiple prefixes:", [...prefixes]);
  }
  const codePrefix = [...prefixes][0] || "MX";
  const items = rows.map(({ suffix, name }) => ({ suffix, name }));
  return [{ kind: "scrap", name: "Scrap", codePrefix, items }];
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  let orgId = args.orgId;
  if (!orgId && args.orgSlug) {
    const org = await prisma.org.findUnique({ where: { slug: args.orgSlug }, select: { id: true } });
    if (!org) throw new Error(`Org slug not found: ${args.orgSlug}`);
    orgId = org.id;
  }
  if (!orgId) {
    console.error("Provide --org-id <uuid> or --org-slug <slug>");
    process.exit(1);
  }

  const downtimeCats = parseDowntimeXlsx(args.downtimePath);
  const scrapCats = parseScrapXlsx(args.scrapPath);

  const totalItems =
    downtimeCats.reduce((n, c) => n + c.items.length, 0) + scrapCats.reduce((n, c) => n + c.items.length, 0);

  console.log("[seed] downtime categories:", downtimeCats.length, "scrap categories:", scrapCats.length);
  console.log("[seed] total items:", totalItems);

  if (args.dryRun) {
    console.log(JSON.stringify({ downtimeCats: downtimeCats.slice(0, 2), scrapCats }, null, 2));
    return;
  }

  const existing = await prisma.reasonCatalogCategory.count({ where: { orgId } });
  if (existing && !args.replace) {
    console.error(
      `Org already has ${existing} catalog categor(ies). Re-run with --replace to wipe and reload, or use Control Tower UI.`
    );
    process.exit(1);
  }

  const bundled = [...downtimeCats, ...scrapCats];
  /** @type {string[]} */
  const dupCheck = [];

  await prisma.$transaction(async (tx) => {
    if (args.replace) {
      await tx.reasonCatalogItem.deleteMany({ where: { orgId } });
      await tx.reasonCatalogCategory.deleteMany({ where: { orgId } });
    }

    let catOrder = 0;
    for (const block of bundled) {
      const category = await tx.reasonCatalogCategory.create({
        data: {
          orgId,
          kind: block.kind,
          name: block.name,
          codePrefix: block.codePrefix,
          sortOrder: catOrder++,
          active: true,
        },
      });

      let itOrder = 0;
      for (const row of block.items) {
        const reasonCode = composeReasonCode(block.codePrefix, row.suffix);
        dupCheck.push(reasonCode);

        await tx.reasonCatalogItem.create({
          data: {
            orgId,
            categoryId: category.id,
            name: row.name,
            codeSuffix: row.suffix,
            reasonCode,
            sortOrder: itOrder++,
            active: true,
          },
        });
      }
    }

    await tx.orgSettings.update({
      where: { orgId },
      data: { version: { increment: 1 } },
    });
  });

  const seen = new Set();
  let dup = 0;
  for (const rc of dupCheck) {
    if (seen.has(rc)) dup++;
    seen.add(rc);
  }
  if (dup) console.warn("[seed] duplicate reason_code skipped by DB unique?", dup);

  console.log("[seed] done. Bump org_settings.version (+1).");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
