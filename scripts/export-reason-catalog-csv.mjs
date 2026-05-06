#!/usr/bin/env node
/**
 * Export reasonCatalog JSON (downtime + scrap) to CSV for printed operator sheets.
 * Usage: node scripts/export-reason-catalog-csv.mjs <path-to-catalog.json>
 *        cat reasonCatalog.json | node scripts/export-reason-catalog-csv.mjs
 *
 * CSV columns: kind, reasonCode, categoryLabel, reasonLabel, active
 */
import { readFileSync, existsSync } from "fs";

function escCsv(s) {
  const t = String(s ?? "");
  if (/[",\n\r]/.test(t)) return `"${t.replace(/"/g, '""')}"`;
  return t;
}

function effectiveReasonCode(categoryId, detail) {
  const c = String(detail.reasonCode ?? detail.code ?? "").trim();
  if (c) return c.toUpperCase();
  const cat = String(categoryId ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const det = String(detail.id ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${cat}__${det}`.toUpperCase();
}

function walk(kind, categories, rows) {
  if (!Array.isArray(categories)) return;
  for (const cat of categories) {
    const cid = String(cat.id ?? "").trim();
    const clab = String(cat.label ?? "").trim();
    const details = Array.isArray(cat.details)
      ? cat.details
      : Array.isArray(cat.children)
        ? cat.children
        : [];
    for (const d of details) {
      const active = d.active === false ? "0" : "1";
      const dlab = String(d.label ?? "").trim();
      rows.push({
        kind,
        reasonCode: effectiveReasonCode(cid || clab, d),
        categoryLabel: clab,
        reasonLabel: dlab,
        active,
      });
    }
  }
}

let raw = "";
const arg = process.argv[2];
if (arg && existsSync(arg)) {
  raw = readFileSync(arg, "utf8");
} else {
  raw = readFileSync(0, "utf8");
}

const catalog = JSON.parse(raw || "{}");
const rows = [];
walk("downtime", catalog.downtime, rows);
walk("scrap", catalog.scrap, rows);

const header = ["kind", "reasonCode", "categoryLabel", "reasonLabel", "active"];
console.log(header.map(escCsv).join(","));
for (const r of rows) {
  console.log([r.kind, r.reasonCode, r.categoryLabel, r.reasonLabel, r.active].map(escCsv).join(","));
}
