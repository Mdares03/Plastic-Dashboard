"use client";

import React, { useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n/useI18n";

type ReasonItem = { id: string; name: string; reasonCode: string };
type ReasonCategory = { id: string; name: string; items: ReasonItem[] };

export type ReclassifyTarget = {
  reasonEntryId: string;
  machineName: string | null;
  reasonCode: string;
  reasonLabel: string;
  startAt: string | null;
};

const OTHER_CODE = "OTHER";

/**
 * B3 — modal to assign a real reason to a downtime episode after the fact.
 * Category → reason, plus an "Other" free-text fallback. Posts to /api/downtime/reclassify,
 * which stamps classifiedBy/At/Via. On success calls onDone() so the table refreshes.
 */
export default function ReclassifyModal({
  target,
  onClose,
  onDone,
}: {
  target: ReclassifyTarget;
  onClose: () => void;
  onDone: () => void;
}) {
  const { t, locale } = useI18n();
  const [categories, setCategories] = useState<ReasonCategory[] | null>(null);
  const [categoryId, setCategoryId] = useState<string>("");
  const [reasonCode, setReasonCode] = useState<string>("");
  const [otherText, setOtherText] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch("/api/downtime/reclassify", { cache: "no-cache", credentials: "include" });
        const j = await r.json().catch(() => ({}));
        if (!alive) return;
        if (!r.ok || j.ok === false) {
          setError(j?.error ?? t("reclassify.loadFailed"));
        } else {
          setCategories(j.categories ?? []);
        }
      } catch (e: unknown) {
        if (alive) setError(e instanceof Error ? e.message : t("common.networkError"));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const activeCategory = categories?.find((c) => c.id === categoryId) ?? null;
  const isOther = reasonCode === OTHER_CODE;
  const canSave = !saving && (isOther ? otherText.trim().length >= 2 : reasonCode.length > 0);

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    try {
      const r = await fetch("/api/downtime/reclassify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          reasonEntryId: target.reasonEntryId,
          reasonCode,
          categoryId: isOther ? null : categoryId || null,
          reasonText: isOther ? otherText.trim() : null,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.ok === false) {
        setError(j?.error ?? t("reclassify.saveFailed"));
        setSaving(false);
        return;
      }
      onDone();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : t("common.networkError"));
      setSaving(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-md rounded-2xl border border-white/10 bg-zinc-900 p-6"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <h2 className="text-lg font-semibold text-white">{t("reclassify.title")}</h2>
        <p className="mt-1 text-xs text-zinc-300">
          {target.machineName ?? "—"} · {target.startAt ? new Date(target.startAt).toLocaleString(locale) : "—"}
        </p>
        <p className="mt-1 text-xs text-zinc-400">
          {t("reclassify.current")} <span className="text-zinc-200">{target.reasonLabel || target.reasonCode}</span>
        </p>

        {loading ? (
          <div className="mt-6 text-sm text-zinc-300">{t("reclassify.loadingReasons")}</div>
        ) : categories && categories.length === 0 ? (
          <div className="mt-6 text-sm text-amber-300">{t("reclassify.noCatalog")}</div>
        ) : (
          <div className="mt-5 space-y-4">
            <label className="block">
              <span className="text-xs text-zinc-300">{t("reclassify.category")}</span>
              <select
                className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
                value={categoryId}
                onChange={(e) => {
                  setCategoryId(e.target.value);
                  setReasonCode("");
                }}
              >
                <option value="">{t("common.select")}</option>
                {categories?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
                <option value="">{t("reclassify.orSeparator")}</option>
              </select>
            </label>

            <label className="block">
              <span className="text-xs text-zinc-300">{t("reclassify.reason")}</span>
              <select
                className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white disabled:opacity-50"
                value={reasonCode}
                disabled={!activeCategory}
                onChange={(e) => setReasonCode(e.target.value)}
              >
                <option value="">{t("common.select")}</option>
                {activeCategory?.items.map((it) => (
                  <option key={it.id} value={it.reasonCode}>
                    {it.name}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="button"
              className={`text-xs underline ${isOther ? "text-emerald-300" : "text-zinc-300"}`}
              onClick={() => {
                setReasonCode(OTHER_CODE);
                setCategoryId("");
              }}
            >
              {t("reclassify.other")}
            </button>

            {isOther ? (
              <label className="block">
                <span className="text-xs text-zinc-300">{t("reclassify.describe")}</span>
                <input
                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-zinc-400"
                  value={otherText}
                  onChange={(e) => setOtherText(e.target.value)}
                  placeholder={t("reclassify.placeholder")}
                  autoFocus
                />
              </label>
            ) : null}

            {error ? <div className="text-xs text-red-300">{error}</div> : null}
          </div>
        )}

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            className="rounded-lg px-4 py-2 text-sm text-zinc-200 hover:bg-white/5"
            onClick={onClose}
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="rounded-lg bg-emerald-500 px-4 py-2 text-sm font-semibold text-black disabled:opacity-40"
            disabled={!canSave}
            onClick={save}
          >
            {saving ? t("reclassify.saving") : t("reclassify.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
