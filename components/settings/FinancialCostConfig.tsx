"use client";

import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n/useI18n";

type OrgProfile = {
  orgId: string;
  defaultCurrency: string;
  machineCostPerMin?: number | null;
  operatorCostPerMin?: number | null;
  ratedRunningKw?: number | null;
  idleKw?: number | null;
  kwhRate?: number | null;
  energyMultiplier?: number | null;
  energyCostPerMin?: number | null;
  scrapCostPerUnit?: number | null;
  rawMaterialCostPerUnit?: number | null;
};

type LocationOverride = {
  id: string;
  location: string;
  currency?: string | null;
  machineCostPerMin?: number | null;
  operatorCostPerMin?: number | null;
  ratedRunningKw?: number | null;
  idleKw?: number | null;
  kwhRate?: number | null;
  energyMultiplier?: number | null;
  energyCostPerMin?: number | null;
  scrapCostPerUnit?: number | null;
  rawMaterialCostPerUnit?: number | null;
};

type MachineOverride = {
  id: string;
  machineId: string;
  currency?: string | null;
  machineCostPerMin?: number | null;
  operatorCostPerMin?: number | null;
  ratedRunningKw?: number | null;
  idleKw?: number | null;
  kwhRate?: number | null;
  energyMultiplier?: number | null;
  energyCostPerMin?: number | null;
  scrapCostPerUnit?: number | null;
  rawMaterialCostPerUnit?: number | null;
};

type ProductOverride = {
  id: string;
  sku: string;
  currency?: string | null;
  rawMaterialCostPerUnit?: number | null;
};

type MachineRow = {
  id: string;
  name: string;
  location?: string | null;
};

type CostConfig = {
  org: OrgProfile | null;
  locations: LocationOverride[];
  machines: MachineOverride[];
  products: ProductOverride[];
};

type OrgForm = {
  defaultCurrency: string;
  machineCostPerMin: string;
  operatorCostPerMin: string;
  ratedRunningKw: string;
  idleKw: string;
  kwhRate: string;
  energyMultiplier: string;
  energyCostPerMin: string;
  scrapCostPerUnit: string;
  rawMaterialCostPerUnit: string;
};

type OverrideForm = {
  id: string;
  location?: string;
  machineId?: string;
  currency: string;
  machineCostPerMin: string;
  operatorCostPerMin: string;
  ratedRunningKw: string;
  idleKw: string;
  kwhRate: string;
  energyMultiplier: string;
  energyCostPerMin: string;
  scrapCostPerUnit: string;
  rawMaterialCostPerUnit: string;
};

type ProductForm = {
  id: string;
  sku: string;
  currency: string;
  rawMaterialCostPerUnit: string;
};

const COST_FIELDS = [
  { key: "machineCostPerMin", labelKey: "financial.field.machineCostPerMin" },
  { key: "operatorCostPerMin", labelKey: "financial.field.operatorCostPerMin" },
  { key: "ratedRunningKw", labelKey: "financial.field.ratedRunningKw" },
  { key: "idleKw", labelKey: "financial.field.idleKw" },
  { key: "kwhRate", labelKey: "financial.field.kwhRate" },
  { key: "energyMultiplier", labelKey: "financial.field.energyMultiplier" },
  { key: "energyCostPerMin", labelKey: "financial.field.energyCostPerMin" },
  { key: "scrapCostPerUnit", labelKey: "financial.field.scrapCostPerUnit" },
  { key: "rawMaterialCostPerUnit", labelKey: "financial.field.rawMaterialCostPerUnit" },
] as const;

type CostFieldKey = (typeof COST_FIELDS)[number]["key"];

function makeId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function toFieldValue(value?: number | null) {
  if (value === null || value === undefined || Number.isNaN(value)) return "";
  return String(value);
}

function parseNumber(input: string) {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

export function FinancialCostConfig() {
  const { t } = useI18n();
  const [role, setRole] = useState<string | null>(null);
  const [machines, setMachines] = useState<MachineRow[]>([]);
  const [config, setConfig] = useState<CostConfig | null>(null);
  const [orgForm, setOrgForm] = useState<OrgForm>({
    defaultCurrency: "USD",
    machineCostPerMin: "",
    operatorCostPerMin: "",
    ratedRunningKw: "",
    idleKw: "",
    kwhRate: "",
    energyMultiplier: "1",
    energyCostPerMin: "",
    scrapCostPerUnit: "",
    rawMaterialCostPerUnit: "",
  });
  const [locationRows, setLocationRows] = useState<OverrideForm[]>([]);
  const [machineRows, setMachineRows] = useState<OverrideForm[]>([]);
  const [productRows, setProductRows] = useState<ProductForm[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  const locations = useMemo(() => {
    const seen = new Set<string>();
    for (const m of machines) {
      if (!m.location) continue;
      seen.add(m.location);
    }
    return Array.from(seen).sort();
  }, [machines]);

  useEffect(() => {
    let alive = true;

    async function loadMe() {
      try {
        const res = await fetch("/api/me", { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (!alive) return;
        setRole(data?.membership?.role ?? null);
      } catch {
        if (alive) setRole(null);
      }
    }

    loadMe();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;

    async function load() {
      try {
        const [machinesRes, costsRes] = await Promise.all([
          fetch("/api/machines", { cache: "no-store" }),
          fetch("/api/financial/costs", { cache: "no-store" }),
        ]);
        const machinesJson = await machinesRes.json().catch(() => ({}));
        const costsJson = await costsRes.json().catch(() => ({}));
        if (!alive) return;
        setMachines(machinesJson.machines ?? []);
        setConfig({
          org: costsJson.org ?? null,
          locations: costsJson.locations ?? [],
          machines: costsJson.machines ?? [],
          products: costsJson.products ?? [],
        });
      } catch {
        if (!alive) return;
      } finally {
        if (alive) setLoading(false);
      }
    }

    load();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!config) return;
    const org = config.org;
    setOrgForm({
      defaultCurrency: org?.defaultCurrency ?? "USD",
      machineCostPerMin: toFieldValue(org?.machineCostPerMin),
      operatorCostPerMin: toFieldValue(org?.operatorCostPerMin),
      ratedRunningKw: toFieldValue(org?.ratedRunningKw),
      idleKw: toFieldValue(org?.idleKw),
      kwhRate: toFieldValue(org?.kwhRate),
      energyMultiplier: toFieldValue(org?.energyMultiplier ?? 1),
      energyCostPerMin: toFieldValue(org?.energyCostPerMin),
      scrapCostPerUnit: toFieldValue(org?.scrapCostPerUnit),
      rawMaterialCostPerUnit: toFieldValue(org?.rawMaterialCostPerUnit),
    });

    setLocationRows(
      (config.locations ?? []).map((row) => ({
        id: row.id ?? makeId("loc"),
        location: row.location,
        currency: row.currency ?? "",
        machineCostPerMin: toFieldValue(row.machineCostPerMin),
        operatorCostPerMin: toFieldValue(row.operatorCostPerMin),
        ratedRunningKw: toFieldValue(row.ratedRunningKw),
        idleKw: toFieldValue(row.idleKw),
        kwhRate: toFieldValue(row.kwhRate),
        energyMultiplier: toFieldValue(row.energyMultiplier),
        energyCostPerMin: toFieldValue(row.energyCostPerMin),
        scrapCostPerUnit: toFieldValue(row.scrapCostPerUnit),
        rawMaterialCostPerUnit: toFieldValue(row.rawMaterialCostPerUnit),
      }))
    );

    setMachineRows(
      (config.machines ?? []).map((row) => ({
        id: row.id ?? makeId("machine"),
        machineId: row.machineId,
        currency: row.currency ?? "",
        machineCostPerMin: toFieldValue(row.machineCostPerMin),
        operatorCostPerMin: toFieldValue(row.operatorCostPerMin),
        ratedRunningKw: toFieldValue(row.ratedRunningKw),
        idleKw: toFieldValue(row.idleKw),
        kwhRate: toFieldValue(row.kwhRate),
        energyMultiplier: toFieldValue(row.energyMultiplier),
        energyCostPerMin: toFieldValue(row.energyCostPerMin),
        scrapCostPerUnit: toFieldValue(row.scrapCostPerUnit),
        rawMaterialCostPerUnit: toFieldValue(row.rawMaterialCostPerUnit),
      }))
    );

    setProductRows(
      (config.products ?? []).map((row) => ({
        id: row.id ?? makeId("product"),
        sku: row.sku,
        currency: row.currency ?? "",
        rawMaterialCostPerUnit: toFieldValue(row.rawMaterialCostPerUnit),
      }))
    );
  }, [config]);

  async function handleSave() {
    setSaving(true);
    setSaveStatus(null);

    const orgPayload = {
      defaultCurrency: orgForm.defaultCurrency.trim() || undefined,
      machineCostPerMin: parseNumber(orgForm.machineCostPerMin),
      operatorCostPerMin: parseNumber(orgForm.operatorCostPerMin),
      ratedRunningKw: parseNumber(orgForm.ratedRunningKw),
      idleKw: parseNumber(orgForm.idleKw),
      kwhRate: parseNumber(orgForm.kwhRate),
      energyMultiplier: parseNumber(orgForm.energyMultiplier),
      energyCostPerMin: parseNumber(orgForm.energyCostPerMin),
      scrapCostPerUnit: parseNumber(orgForm.scrapCostPerUnit),
      rawMaterialCostPerUnit: parseNumber(orgForm.rawMaterialCostPerUnit),
    };

    const locationPayload = locationRows
      .filter((row) => row.location)
      .map((row) => ({
        location: row.location || "",
        currency: row.currency.trim() || null,
        machineCostPerMin: parseNumber(row.machineCostPerMin),
        operatorCostPerMin: parseNumber(row.operatorCostPerMin),
        ratedRunningKw: parseNumber(row.ratedRunningKw),
        idleKw: parseNumber(row.idleKw),
        kwhRate: parseNumber(row.kwhRate),
        energyMultiplier: parseNumber(row.energyMultiplier),
        energyCostPerMin: parseNumber(row.energyCostPerMin),
        scrapCostPerUnit: parseNumber(row.scrapCostPerUnit),
        rawMaterialCostPerUnit: parseNumber(row.rawMaterialCostPerUnit),
      }));

    const machinePayload = machineRows
      .filter((row) => row.machineId)
      .map((row) => ({
        machineId: row.machineId || "",
        currency: row.currency.trim() || null,
        machineCostPerMin: parseNumber(row.machineCostPerMin),
        operatorCostPerMin: parseNumber(row.operatorCostPerMin),
        ratedRunningKw: parseNumber(row.ratedRunningKw),
        idleKw: parseNumber(row.idleKw),
        kwhRate: parseNumber(row.kwhRate),
        energyMultiplier: parseNumber(row.energyMultiplier),
        energyCostPerMin: parseNumber(row.energyCostPerMin),
        scrapCostPerUnit: parseNumber(row.scrapCostPerUnit),
        rawMaterialCostPerUnit: parseNumber(row.rawMaterialCostPerUnit),
      }));

    const productPayload = productRows
      .filter((row) => row.sku)
      .map((row) => ({
        sku: row.sku.trim(),
        currency: row.currency.trim() || null,
        rawMaterialCostPerUnit: parseNumber(row.rawMaterialCostPerUnit),
      }));

    try {
      const res = await fetch("/api/financial/costs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          org: orgPayload,
          locations: locationPayload,
          machines: machinePayload,
          products: productPayload,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSaveStatus(json?.error ?? t("financial.config.saveFailed"));
      } else {
        setConfig({
          org: json.org ?? null,
          locations: json.locations ?? [],
          machines: json.machines ?? [],
          products: json.products ?? [],
        });
        setSaveStatus(t("financial.config.saved"));
      }
    } catch {
      setSaveStatus(t("financial.config.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  function updateOrgField(key: CostFieldKey, value: string) {
    setOrgForm((prev) => ({ ...prev, [key]: value }));
  }

  function updateLocationRow(id: string, key: keyof OverrideForm, value: string) {
    setLocationRows((prev) => prev.map((row) => (row.id === id ? { ...row, [key]: value } : row)));
  }

  function updateMachineRow(id: string, key: keyof OverrideForm, value: string) {
    setMachineRows((prev) => prev.map((row) => (row.id === id ? { ...row, [key]: value } : row)));
  }

  function updateProductRow(id: string, key: keyof ProductForm, value: string) {
    setProductRows((prev) => prev.map((row) => (row.id === id ? { ...row, [key]: value } : row)));
  }

  function addLocationRow() {
    setLocationRows((prev) => [
      ...prev,
      {
        id: makeId("loc"),
        location: "",
        currency: "",
        machineCostPerMin: "",
        operatorCostPerMin: "",
        ratedRunningKw: "",
        idleKw: "",
        kwhRate: "",
        energyMultiplier: "",
        energyCostPerMin: "",
        scrapCostPerUnit: "",
        rawMaterialCostPerUnit: "",
      },
    ]);
  }

  function addMachineRow() {
    setMachineRows((prev) => [
      ...prev,
      {
        id: makeId("machine"),
        machineId: "",
        currency: "",
        machineCostPerMin: "",
        operatorCostPerMin: "",
        ratedRunningKw: "",
        idleKw: "",
        kwhRate: "",
        energyMultiplier: "",
        energyCostPerMin: "",
        scrapCostPerUnit: "",
        rawMaterialCostPerUnit: "",
      },
    ]);
  }

  function addProductRow() {
    setProductRows((prev) => [
      ...prev,
      { id: makeId("product"), sku: "", currency: "", rawMaterialCostPerUnit: "" },
    ]);
  }

  function applyOrgToAllMachines() {
    setMachineRows(
      machines.map((m) => ({
        id: makeId("machine"),
        machineId: m.id,
        currency: orgForm.defaultCurrency,
        machineCostPerMin: orgForm.machineCostPerMin,
        operatorCostPerMin: orgForm.operatorCostPerMin,
        ratedRunningKw: orgForm.ratedRunningKw,
        idleKw: orgForm.idleKw,
        kwhRate: orgForm.kwhRate,
        energyMultiplier: orgForm.energyMultiplier,
        energyCostPerMin: orgForm.energyCostPerMin,
        scrapCostPerUnit: orgForm.scrapCostPerUnit,
        rawMaterialCostPerUnit: orgForm.rawMaterialCostPerUnit,
      }))
    );
  }

  if (role && role !== "OWNER") {
    return (
      <div className="rounded-2xl border border-white/10 bg-black/40 p-6 text-zinc-300">
        {t("financial.config.ownerOnly")}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-black/40 p-4 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-white">{t("financial.config.title")}</h2>
          <p className="text-xs text-zinc-500">{t("financial.config.subtitle")}</p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={applyOrgToAllMachines}
            className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-zinc-200 hover:bg-white/10"
          >
            {t("financial.config.applyOrg")}
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-lg bg-emerald-500/80 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500"
          >
            {saving ? t("financial.config.saving") : t("financial.config.save")}
          </button>
        </div>
      </div>

      {saveStatus && <div className="text-xs text-zinc-400">{saveStatus}</div>}

      <div className="grid gap-4">
        <div className="rounded-xl border border-white/10 bg-black/20 p-4">
          <div className="mb-4 flex items-center gap-4">
            <div className="text-sm font-semibold text-white">{t("financial.config.orgDefaults")}</div>
            <div className="flex-1" />
            <input
              className="w-28 rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-200"
              value={orgForm.defaultCurrency}
              onChange={(event) =>
                setOrgForm((prev) => ({ ...prev, defaultCurrency: event.target.value.toUpperCase() }))
              }
              placeholder="USD"
            />
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {COST_FIELDS.map((field) => (
              <label key={field.key} className="text-xs text-zinc-400">
                {t(field.labelKey)}
                <input
                  className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-200"
                  value={orgForm[field.key]}
                  onChange={(event) => updateOrgField(field.key, event.target.value)}
                />
              </label>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-white/10 bg-black/20 p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-white">{t("financial.config.locationOverrides")}</div>
            <button
              type="button"
              onClick={addLocationRow}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-zinc-200 hover:bg-white/10"
            >
              {t("financial.config.addLocation")}
            </button>
          </div>
          {locationRows.length === 0 && (
            <div className="text-xs text-zinc-500">{t("financial.config.noneLocation")}</div>
          )}
          {locationRows.map((row) => (
            <div key={row.id} className="rounded-xl border border-white/10 bg-black/30 p-4">
              <div className="grid gap-3 md:grid-cols-3">
                <label className="text-xs text-zinc-400">
                  {t("financial.config.location")}
                  <select
                    className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-200"
                    value={row.location ?? ""}
                    onChange={(event) => updateLocationRow(row.id, "location", event.target.value)}
                  >
                    <option value="">{t("financial.config.selectLocation")}</option>
                    {locations.map((loc) => (
                      <option key={loc} value={loc}>
                        {loc}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-zinc-400">
                  {t("financial.config.currency")}
                  <input
                    className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-200"
                    value={row.currency}
                    onChange={(event) => updateLocationRow(row.id, "currency", event.target.value.toUpperCase())}
                    placeholder="MXN"
                  />
                </label>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                {COST_FIELDS.map((field) => (
                  <label key={field.key} className="text-xs text-zinc-400">
                    {t(field.labelKey)}
                    <input
                      className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-200"
                      value={row[field.key]}
                      onChange={(event) => updateLocationRow(row.id, field.key, event.target.value)}
                    />
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="rounded-xl border border-white/10 bg-black/20 p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-white">{t("financial.config.machineOverrides")}</div>
            <button
              type="button"
              onClick={addMachineRow}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-zinc-200 hover:bg-white/10"
            >
              {t("financial.config.addMachine")}
            </button>
          </div>
          {machineRows.length === 0 && (
            <div className="text-xs text-zinc-500">{t("financial.config.noneMachine")}</div>
          )}
          {machineRows.map((row) => (
            <div key={row.id} className="rounded-xl border border-white/10 bg-black/30 p-4">
              <div className="grid gap-3 md:grid-cols-3">
                <label className="text-xs text-zinc-400">
                  {t("financial.config.machine")}
                  <select
                    className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-200"
                    value={row.machineId ?? ""}
                    onChange={(event) => updateMachineRow(row.id, "machineId", event.target.value)}
                  >
                    <option value="">{t("financial.config.selectMachine")}</option>
                    {machines.map((machine) => (
                      <option key={machine.id} value={machine.id}>
                        {machine.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-zinc-400">
                  {t("financial.config.currency")}
                  <input
                    className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-200"
                    value={row.currency}
                    onChange={(event) => updateMachineRow(row.id, "currency", event.target.value.toUpperCase())}
                    placeholder="MXN"
                  />
                </label>
              </div>
              <div className="mt-4 grid gap-3 md:grid-cols-3">
                {COST_FIELDS.map((field) => (
                  <label key={field.key} className="text-xs text-zinc-400">
                    {t(field.labelKey)}
                    <input
                      className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-200"
                      value={row[field.key]}
                      onChange={(event) => updateMachineRow(row.id, field.key, event.target.value)}
                    />
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="rounded-xl border border-white/10 bg-black/20 p-4 space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-sm font-semibold text-white">{t("financial.config.productOverrides")}</div>
            <button
              type="button"
              onClick={addProductRow}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-zinc-200 hover:bg-white/10"
            >
              {t("financial.config.addProduct")}
            </button>
          </div>
          {productRows.length === 0 && (
            <div className="text-xs text-zinc-500">{t("financial.config.noneProduct")}</div>
          )}
          {productRows.map((row) => (
            <div key={row.id} className="rounded-xl border border-white/10 bg-black/30 p-4">
              <div className="grid gap-3 md:grid-cols-3">
                <label className="text-xs text-zinc-400">
                  {t("financial.config.sku")}
                  <input
                    className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-200"
                    value={row.sku}
                    onChange={(event) => updateProductRow(row.id, "sku", event.target.value)}
                    placeholder="SKU-001"
                  />
                </label>
                <label className="text-xs text-zinc-400">
                  {t("financial.config.currency")}
                  <input
                    className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-200"
                    value={row.currency}
                    onChange={(event) => updateProductRow(row.id, "currency", event.target.value.toUpperCase())}
                    placeholder="MXN"
                  />
                </label>
                <label className="text-xs text-zinc-400">
                  {t("financial.config.rawMaterialUnit")}
                  <input
                    className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-zinc-200"
                    value={row.rawMaterialCostPerUnit}
                    onChange={(event) => updateProductRow(row.id, "rawMaterialCostPerUnit", event.target.value)}
                  />
                </label>
              </div>
            </div>
          ))}
        </div>
      </div>

      {loading && <div className="text-xs text-zinc-500">{t("financial.config.loading")}</div>}
    </div>
  );
}
