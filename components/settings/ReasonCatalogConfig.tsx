"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n/useI18n";

type CatalogKind = "downtime" | "scrap";

type ApiItem = {
  id: string;
  name: string;
  codeSuffix: string;
  reasonCode: string;
  sortOrder: number;
  active: boolean;
};

type ApiCategory = {
  id: string;
  kind: string;
  name: string;
  codePrefix: string;
  sortOrder: number;
  active: boolean;
  items: ApiItem[];
};

const PREFIX_RE = /^[A-Za-z][A-Za-z0-9-]*$/;

/** Matches composeReasonCode in reasonCatalogDb (client-safe). */
function formatPrintedPreview(prefix: string, digits: string): string {
  const p = String(prefix).trim().toUpperCase();
  const d = String(digits).trim();
  if (!d) return p.length >= 3 ? `${p}-…` : `${p}…`;
  if (/^\d+$/.test(d) && p.length >= 3) return `${p}-${d}`;
  return `${p}${d}`;
}

async function readJson(res: Response) {
  const data = await res.json().catch(() => null);
  return data as Record<string, unknown> | null;
}

export function ReasonCatalogConfig({ disabled }: { disabled?: boolean }) {
  const { t } = useI18n();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [catalogVersion, setCatalogVersion] = useState(1);
  const [categories, setCategories] = useState<ApiCategory[]>([]);
  const [kind, setKind] = useState<CatalogKind>("downtime");
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null);
  const [newCatName, setNewCatName] = useState("");
  const [newCatPrefix, setNewCatPrefix] = useState("");
  const [newDigits, setNewDigits] = useState("");
  const [newItemName, setNewItemName] = useState("");
  const [busy, setBusy] = useState(false);
  const [editCatName, setEditCatName] = useState("");
  const [editCatPrefix, setEditCatPrefix] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/reason-catalog");
      const data = await readJson(res);
      if (!res.ok || !data || data.ok !== true) {
        const msg = typeof data?.error === "string" ? data.error : "Load failed";
        throw new Error(msg);
      }
      setCatalogVersion(Number(data.catalogVersion ?? 1));
      setCategories(Array.isArray(data.categories) ? (data.categories as ApiCategory[]) : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Load failed");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const forKind = useMemo(
    () => categories.filter((c) => String(c.kind).toLowerCase() === kind),
    [categories, kind]
  );

  const selected = useMemo(
    () => forKind.find((c) => c.id === selectedCategoryId) ?? null,
    [forKind, selectedCategoryId]
  );

  useEffect(() => {
    if (!selected) {
      setEditCatName("");
      setEditCatPrefix("");
      return;
    }
    setEditCatName(selected.name);
    setEditCatPrefix(selected.codePrefix);
  }, [selected?.id, selected?.name, selected?.codePrefix]);

  useEffect(() => {
    if (!forKind.length) {
      setSelectedCategoryId(null);
      return;
    }
    if (!selectedCategoryId || !forKind.some((c) => c.id === selectedCategoryId)) {
      setSelectedCategoryId(forKind[0]?.id ?? null);
    }
  }, [forKind, selectedCategoryId]);

  const onDigitsChange = (raw: string) => {
    setNewDigits(raw.replace(/\D/g, ""));
  };

  const createCategory = async () => {
    const name = newCatName.trim();
    const codePrefix = newCatPrefix.trim().toUpperCase();
    if (!name || !codePrefix) return;
    if (!PREFIX_RE.test(codePrefix)) {
      setError(t("settings.reasonCatalog.prefixInvalid"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/reason-catalog/categories", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, name, codePrefix }),
      });
      const data = await readJson(res);
      if (!res.ok || !data || data.ok !== true) {
        const msg = typeof data?.error === "string" ? data.error : "Create failed";
        throw new Error(msg);
      }
      setNewCatName("");
      setNewCatPrefix("");
      await load();
      const cat = data.category as { id?: string } | undefined;
      if (cat?.id) setSelectedCategoryId(cat.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
    } finally {
      setBusy(false);
    }
  };

  const addItem = async () => {
    if (!selected) return;
    const digits = newDigits.trim();
    const name = newItemName.trim();
    if (!digits || !name) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/reason-catalog/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ categoryId: selected.id, codeSuffix: digits, name }),
      });
      const data = await readJson(res);
      if (!res.ok || !data || data.ok !== true) {
        const msg = typeof data?.error === "string" ? data.error : "Create failed";
        throw new Error(msg);
      }
      setNewDigits("");
      setNewItemName("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Create failed");
    } finally {
      setBusy(false);
    }
  };

  const patchItem = async (itemId: string, patch: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/settings/reason-catalog/items/${itemId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await readJson(res);
      if (!res.ok || !data || data.ok !== true) {
        const msg = typeof data?.error === "string" ? data.error : "Update failed";
        throw new Error(msg);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(false);
    }
  };

  const patchCategory = async (categoryId: string, patch: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/settings/reason-catalog/categories/${categoryId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const data = await readJson(res);
      if (!res.ok || !data || data.ok !== true) {
        const msg = typeof data?.error === "string" ? data.error : "Update failed";
        throw new Error(msg);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(false);
    }
  };

  const inputCls =
    "mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-xs text-white placeholder:text-zinc-600";

  const kindBtn = (k: CatalogKind, label: string) => (
    <button
      type="button"
      disabled={disabled || busy}
      onClick={() => setKind(k)}
      className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
        kind === k ? "bg-emerald-500/25 text-emerald-100 ring-1 ring-emerald-400/40" : "bg-black/30 text-zinc-400 hover:bg-white/5"
      } disabled:opacity-40`}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-white/10 bg-black/20 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-[11px] text-zinc-500">
            {t("settings.reasonCatalog.dbVersionHint", { version: catalogVersion })}
          </div>
          <button
            type="button"
            disabled={disabled || busy || loading}
            onClick={() => void load()}
            className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-white hover:bg-white/10 disabled:opacity-40"
          >
            {t("settings.reasonCatalog.reload")}
          </button>
        </div>
        {loading ? <p className="mt-2 text-xs text-zinc-500">{t("settings.loading")}</p> : null}
        {error ? (
          <p className="mt-2 rounded-lg border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-xs text-red-200">{error}</p>
        ) : null}
      </div>

      <div className="rounded-xl border border-white/10 bg-black/20 p-4">
        <div className="text-xs font-semibold text-zinc-300">{t("settings.reasonCatalog.stepKind")}</div>
        <div className="mt-2 flex flex-wrap gap-2">
          {kindBtn("downtime", t("settings.reasonCatalog.downtime"))}
          {kindBtn("scrap", t("settings.reasonCatalog.scrap"))}
        </div>
      </div>

      <div className="rounded-xl border border-white/10 bg-black/20 p-4">
        <div className="text-xs font-semibold text-zinc-300">{t("settings.reasonCatalog.stepCategory")}</div>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-end">
          <label className="min-w-[200px] flex-1 text-[11px] text-zinc-400">
            {t("settings.reasonCatalog.pickCategory")}
            <select
              disabled={disabled || busy || !forKind.length}
              value={selectedCategoryId ?? ""}
              onChange={(e) => setSelectedCategoryId(e.target.value || null)}
              className={`${inputCls} cursor-pointer`}
            >
              {!forKind.length ? <option value="">{t("settings.reasonCatalog.emptyKind")}</option> : null}
              {forKind.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.codePrefix}){c.active ? "" : ` — ${t("settings.reasonCatalog.inactive")}`}
                </option>
              ))}
            </select>
          </label>
        </div>

        {selected ? (
          <div className="mt-4 grid gap-3 rounded-lg border border-white/5 bg-black/30 p-3 sm:grid-cols-2">
            <label className="text-[11px] text-zinc-400">
              {t("settings.reasonCatalog.categoryNameEdit")}
              <input
                disabled={disabled || busy}
                value={editCatName}
                onChange={(e) => setEditCatName(e.target.value)}
                onBlur={() => {
                  const n = editCatName.trim();
                  if (n && n !== selected.name) void patchCategory(selected.id, { name: n });
                }}
                className={inputCls}
              />
            </label>
            <label className="text-[11px] text-zinc-400">
              {t("settings.reasonCatalog.codePrefixEdit")}
              <input
                disabled={disabled || busy}
                value={editCatPrefix}
                onChange={(e) => setEditCatPrefix(e.target.value.toUpperCase())}
                onBlur={() => {
                  const v = editCatPrefix.trim().toUpperCase();
                  if (!v || !PREFIX_RE.test(v)) {
                    setEditCatPrefix(selected.codePrefix);
                    return;
                  }
                  if (v !== selected.codePrefix) void patchCategory(selected.id, { codePrefix: v });
                }}
                className={inputCls}
              />
            </label>
            <label className="flex items-center gap-2 text-[11px] text-zinc-400 sm:col-span-2">
              <input
                type="checkbox"
                disabled={disabled || busy}
                checked={selected.active}
                onChange={(e) => void patchCategory(selected.id, { active: e.target.checked })}
                className="h-3.5 w-3.5 rounded border border-white/20 bg-black/20"
              />
              {t("settings.reasonCatalog.categoryActive")}
            </label>
          </div>
        ) : null}

        <div className="mt-4 border-t border-white/5 pt-4">
          <div className="text-[11px] font-semibold text-zinc-400">{t("settings.reasonCatalog.newCategorySection")}</div>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <label className="text-[11px] text-zinc-400">
              {t("settings.reasonCatalog.categoryLabel")}
              <input
                disabled={disabled || busy}
                value={newCatName}
                onChange={(e) => setNewCatName(e.target.value)}
                className={inputCls}
              />
            </label>
            <label className="text-[11px] text-zinc-400">
              {t("settings.reasonCatalog.codePrefixField")}
              <input
                disabled={disabled || busy}
                value={newCatPrefix}
                onChange={(e) => setNewCatPrefix(e.target.value.toUpperCase())}
                placeholder="DTPRC"
                className={inputCls}
              />
            </label>
          </div>
          <button
            type="button"
            disabled={disabled || busy || !newCatName.trim() || !newCatPrefix.trim()}
            onClick={() => void createCategory()}
            className="mt-2 rounded-lg border border-emerald-400/30 bg-emerald-500/15 px-3 py-1.5 text-xs text-emerald-100 hover:bg-emerald-500/25 disabled:opacity-40"
          >
            {t("settings.reasonCatalog.addCategory")}
          </button>
        </div>
      </div>

      {selected ? (
        <div className="rounded-xl border border-white/10 bg-black/20 p-4">
          <div className="text-xs font-semibold text-zinc-300">{t("settings.reasonCatalog.stepReason")}</div>
          <p className="mt-1 text-[11px] text-zinc-500">{t("settings.reasonCatalog.digitsOnlyHint")}</p>
          <div className="mt-3 flex flex-wrap items-end gap-3">
            <div className="text-[11px] text-zinc-400">
              <span className="block text-zinc-500">{t("settings.reasonCatalog.fullCodePreview")}</span>
              <span className="mt-1 inline-flex min-h-[2rem] items-center rounded-lg border border-white/10 bg-black/40 px-3 font-mono text-sm text-emerald-200">
                {formatPrintedPreview(selected.codePrefix, newDigits)}
              </span>
            </div>
            <label className="w-32 text-[11px] text-zinc-400">
              {t("settings.reasonCatalog.numericSuffix")}
              <input
                disabled={disabled || busy}
                inputMode="numeric"
                pattern="[0-9]*"
                value={newDigits}
                onChange={(e) => onDigitsChange(e.target.value)}
                placeholder="01"
                className={inputCls}
              />
            </label>
            <label className="min-w-[180px] flex-1 text-[11px] text-zinc-400">
              {t("settings.reasonCatalog.detailLabel")}
              <input
                disabled={disabled || busy}
                value={newItemName}
                onChange={(e) => setNewItemName(e.target.value)}
                className={inputCls}
              />
            </label>
            <button
              type="button"
              disabled={disabled || busy || !newDigits.trim() || !newItemName.trim()}
              onClick={() => void addItem()}
              className="rounded-lg border border-emerald-400/30 bg-emerald-500/15 px-3 py-2 text-xs text-emerald-100 hover:bg-emerald-500/25 disabled:opacity-40"
            >
              {t("settings.reasonCatalog.addReason")}
            </button>
          </div>

          <div className="mt-4">
            <div className="text-[11px] font-semibold text-zinc-500">{t("settings.reasonCatalog.reasonsInCategory")}</div>
            <div className="mt-2 space-y-2">
              {selected.items.length === 0 ? (
                <div className="text-xs text-zinc-500">{t("settings.reasonCatalog.noItemsYet")}</div>
              ) : (
                selected.items.map((it) => (
                  <div
                    key={it.id}
                    className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/5 px-3 py-2 ${
                      it.active ? "bg-black/30" : "bg-black/10 opacity-60"
                    }`}
                  >
                    <div className="font-mono text-xs text-emerald-200">{it.reasonCode}</div>
                    <div className="min-w-0 flex-1 truncate text-xs text-white">{it.name}</div>
                    <label className="flex items-center gap-1.5 text-[10px] text-zinc-400">
                      <input
                        type="checkbox"
                        disabled={disabled || busy}
                        checked={it.active}
                        onChange={(e) => void patchItem(it.id, { active: e.target.checked })}
                        className="h-3.5 w-3.5 rounded border border-white/20 bg-black/20"
                      />
                      {t("settings.reasonCatalog.active")}
                    </label>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}

      <p className="text-[11px] leading-relaxed text-zinc-500">{t("settings.reasonCatalog.hint")}</p>
    </div>
  );
}
