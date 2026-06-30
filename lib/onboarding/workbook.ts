import * as XLSX from "xlsx";
import { buildOnboardingTemplate } from "@/lib/onboarding/template";

/**
 * Excel (.xlsx) template + parser for onboarding (item 8). Non-technical users
 * fill a familiar spreadsheet instead of editing JSON. The workbook layout and
 * the parser are the two halves of one round-trip: build → user edits → parse →
 * the SAME onboardingConfigSchema validates the result, so Excel is just another
 * front-end for the one shared config shape.
 *
 * Sheet layout:
 *   Instructions  free-text help
 *   Company       key/value (name, timezone)
 *   CostRates     key/value (currency + per-min / energy costs)
 *   Thresholds    key/value (alert thresholds)
 *   Machines      table: name | code | location
 *   Shifts        table: name | startTime | endTime | enabled
 *   Reasons       table: kind | category | codePrefix | planned | reasonName | codeSuffix
 *   Contacts      table: name | roleScope | email | phone
 *
 * Key/value sheets carry the machine-readable field key in column A (users edit
 * the Value column); table sheets are parsed by header name, so column order is
 * free. Reason rows are grouped back into categories by (kind, category).
 */

const SHEET = {
  instructions: "Instructions",
  company: "Company",
  costRates: "CostRates",
  thresholds: "Thresholds",
  machines: "Machines",
  shifts: "Shifts",
  reasons: "Reasons",
  contacts: "Contacts",
} as const;

const FINANCIAL_KEYS = [
  "defaultCurrency",
  "machineCostPerMin",
  "operatorCostPerMin",
  "ratedRunningKw",
  "idleKw",
  "kwhRate",
  "energyMultiplier",
  "scrapCostPerUnit",
  "rawMaterialCostPerUnit",
] as const;

const THRESHOLD_KEYS = [
  "stoppageMultiplier",
  "macroStoppageMultiplier",
  "oeeAlertThresholdPct",
  "performanceThresholdPct",
  "qualitySpikeDeltaPct",
] as const;

const FIELD_NOTES: Record<string, string> = {
  name: "Company / plant name",
  timezone: "IANA timezone, e.g. America/Mexico_City",
  defaultCurrency: "ISO currency code, e.g. MXN",
  machineCostPerMin: "Machine cost per minute",
  operatorCostPerMin: "Operator cost per minute",
  ratedRunningKw: "Rated running power (kW)",
  idleKw: "Idle power (kW)",
  kwhRate: "Energy price per kWh",
  energyMultiplier: "Energy cost multiplier (1.0 = none)",
  scrapCostPerUnit: "Scrap cost per unit",
  rawMaterialCostPerUnit: "Raw material cost per unit",
  stoppageMultiplier: "Micro-stoppage multiplier (1.1–5)",
  macroStoppageMultiplier: "Macro-stoppage multiplier (1.1–20)",
  oeeAlertThresholdPct: "OEE alert threshold % (50–100)",
  performanceThresholdPct: "Performance threshold % (50–100)",
  qualitySpikeDeltaPct: "Quality spike delta % (0–100)",
};

function kvSheet(rows: Array<[string, unknown]>) {
  const aoa: unknown[][] = [["Field", "Value", "Notes"]];
  for (const [key, value] of rows) {
    aoa.push([key, value ?? "", FIELD_NOTES[key] ?? ""]);
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [{ wch: 22 }, { wch: 26 }, { wch: 40 }];
  return ws;
}

function tableSheet(headers: string[], rows: unknown[][]) {
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  ws["!cols"] = headers.map((h) => ({ wch: Math.max(14, h.length + 4) }));
  return ws;
}

/** Build the downloadable .xlsx template, pre-filled with a worked example. */
export function buildOnboardingWorkbook(): Buffer {
  const ex = buildOnboardingTemplate();
  const wb = XLSX.utils.book_new();

  const instructions = [
    ["MaliounTech — company onboarding template"],
    [""],
    ["Fill in the sheets and upload this file in Settings → Onboarding (or use the on-screen wizard)."],
    ["Every sheet is OPTIONAL — clear a sheet you don't need. Re-uploading updates existing rows (idempotent)."],
    ["On the key/value sheets (Company, CostRates, Thresholds), edit the VALUE column only."],
    [""],
    ["Machines: 'name' is required and unique; code/location optional."],
    ["Shifts: startTime/endTime are HH:MM (24h). Uploading shifts REPLACES the current schedule. enabled = yes/no."],
    ["Reasons: one row per reason. kind = downtime or scrap. Rows sharing the same kind+category form one category."],
    ["         codePrefix starts with a letter; codeSuffix is digits only (keep as text to preserve leading zeros)."],
    ["         planned = yes for necessary work (e.g. changeovers) that's excluded from reducible-loss/ROI."],
    ["Contacts: each contact needs at least an email or a phone."],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(instructions), SHEET.instructions);

  XLSX.utils.book_append_sheet(
    wb,
    kvSheet([
      ["name", ex.org?.name ?? ""],
      ["timezone", ex.org?.timezone ?? ""],
    ]),
    SHEET.company
  );

  XLSX.utils.book_append_sheet(
    wb,
    kvSheet(FINANCIAL_KEYS.map((k) => [k, ex.financial?.[k] ?? ""])),
    SHEET.costRates
  );

  XLSX.utils.book_append_sheet(
    wb,
    kvSheet(THRESHOLD_KEYS.map((k) => [k, ex.thresholds?.[k] ?? ""])),
    SHEET.thresholds
  );

  XLSX.utils.book_append_sheet(
    wb,
    tableSheet(
      ["name", "code", "location"],
      (ex.machines ?? []).map((m) => [m.name, m.code ?? "", m.location ?? ""])
    ),
    SHEET.machines
  );

  XLSX.utils.book_append_sheet(
    wb,
    tableSheet(
      ["name", "startTime", "endTime", "enabled"],
      (ex.shifts ?? []).map((s) => [s.name, s.startTime, s.endTime, s.enabled === false ? "no" : "yes"])
    ),
    SHEET.shifts
  );

  const reasonRows: unknown[][] = [];
  for (const cat of ex.reasonCategories ?? []) {
    for (const it of cat.items ?? []) {
      reasonRows.push([cat.kind, cat.name, cat.codePrefix, cat.planned ? "yes" : "no", it.name, it.codeSuffix]);
    }
  }
  XLSX.utils.book_append_sheet(
    wb,
    tableSheet(["kind", "category", "codePrefix", "planned", "reasonName", "codeSuffix"], reasonRows),
    SHEET.reasons
  );

  XLSX.utils.book_append_sheet(
    wb,
    tableSheet(
      ["name", "roleScope", "email", "phone"],
      (ex.alertContacts ?? []).map((c) => [c.name, c.roleScope, c.email ?? "", c.phone ?? ""])
    ),
    SHEET.contacts
  );

  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

// ---- parsing ----

function str(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function parseBool(v: unknown, dflt: boolean): boolean {
  const s = str(v).toLowerCase();
  if (s === "") return dflt;
  if (["no", "false", "0", "n", "off"].includes(s)) return false;
  if (["yes", "true", "1", "y", "on"].includes(s)) return true;
  return dflt;
}

/** key/value sheet → { key: value } (skips the header row + blank keys). */
function readKv(wb: XLSX.WorkBook, sheet: string): Record<string, unknown> {
  const ws = wb.Sheets[sheet];
  if (!ws) return {};
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false });
  const out: Record<string, unknown> = {};
  for (let i = 1; i < aoa.length; i += 1) {
    const key = str(aoa[i]?.[0]);
    if (!key || key.toLowerCase() === "field") continue;
    out[key] = aoa[i]?.[1] ?? "";
  }
  return out;
}

/** table sheet → array of objects keyed by header (lower-cased, trimmed). */
function readTable(wb: XLSX.WorkBook, sheet: string): Record<string, unknown>[] {
  const ws = wb.Sheets[sheet];
  if (!ws) return [];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: "", raw: true });
  return rows.map((r) => {
    const norm: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(r)) norm[str(k).toLowerCase()] = v;
    return norm;
  });
}

function pickNumber(v: unknown): number | undefined {
  const s = str(v);
  if (s === "") return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Parse an uploaded .xlsx into the onboarding config shape (a raw object the
 * caller feeds to onboardingConfigSchema). Missing/empty sheets are simply
 * omitted, so a partial template still parses.
 */
export function parseOnboardingWorkbook(input: ArrayBuffer | Buffer | Uint8Array): Record<string, unknown> {
  const wb = XLSX.read(input, { type: "buffer" });
  const config: Record<string, unknown> = {};

  // Company
  const company = readKv(wb, SHEET.company);
  const org: Record<string, unknown> = {};
  if (str(company.name)) org.name = str(company.name);
  if (str(company.timezone)) org.timezone = str(company.timezone);
  if (Object.keys(org).length) config.org = org;

  // Cost rates — schema coerces blank→undefined, so only include non-blank cells.
  const costs = readKv(wb, SHEET.costRates);
  const financial: Record<string, unknown> = {};
  for (const k of FINANCIAL_KEYS) {
    const raw = costs[k];
    if (str(raw) === "") continue;
    financial[k] = k === "defaultCurrency" ? str(raw) : raw;
  }
  if (Object.keys(financial).length) config.financial = financial;

  // Thresholds — must be numbers for the schema.
  const thr = readKv(wb, SHEET.thresholds);
  const thresholds: Record<string, number> = {};
  for (const k of THRESHOLD_KEYS) {
    const n = pickNumber(thr[k]);
    if (n !== undefined) thresholds[k] = n;
  }
  if (Object.keys(thresholds).length) config.thresholds = thresholds;

  // Machines
  const machines = readTable(wb, SHEET.machines)
    .filter((r) => str(r.name))
    .map((r) => ({ name: str(r.name), code: str(r.code), location: str(r.location) }));
  if (machines.length) config.machines = machines;

  // Shifts
  const shifts = readTable(wb, SHEET.shifts)
    .filter((r) => str(r.name))
    .map((r) => ({
      name: str(r.name),
      startTime: str(r.starttime),
      endTime: str(r.endtime),
      enabled: parseBool(r.enabled, true),
    }));
  if (shifts.length) config.shifts = shifts;

  // Reasons — group rows into categories by (kind, category).
  const reasonRows = readTable(wb, SHEET.reasons);
  const catMap = new Map<string, { kind: string; name: string; codePrefix: string; planned: boolean; items: Array<{ name: string; codeSuffix: string }> }>();
  for (const r of reasonRows) {
    const kind = str(r.kind).toLowerCase();
    const name = str(r.category);
    if (!kind || !name) continue;
    const key = `${kind} ${name}`;
    let cat = catMap.get(key);
    if (!cat) {
      cat = { kind, name, codePrefix: str(r.codeprefix), planned: parseBool(r.planned, false), items: [] };
      catMap.set(key, cat);
    }
    if (!cat.codePrefix) cat.codePrefix = str(r.codeprefix);
    const reasonName = str(r.reasonname);
    const codeSuffix = str(r.codesuffix);
    if (reasonName || codeSuffix) cat.items.push({ name: reasonName, codeSuffix });
  }
  const reasonCategories = Array.from(catMap.values());
  if (reasonCategories.length) config.reasonCategories = reasonCategories;

  // Contacts
  const contacts = readTable(wb, SHEET.contacts)
    .filter((r) => str(r.name))
    .map((r) => ({ name: str(r.name), roleScope: str(r.rolescope), email: str(r.email), phone: str(r.phone) }));
  if (contacts.length) config.alertContacts = contacts;

  return config;
}
