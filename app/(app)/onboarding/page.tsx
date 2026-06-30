"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n/useI18n";
import { ONBOARDING_REASON_KINDS, type OnboardingReasonKind } from "@/lib/onboarding/schema";

/**
 * Phase D (item 8) — on-screen onboarding wizard. Collects the same shape as the
 * downloadable template and POSTs it to /api/onboarding/import, so both paths
 * converge on the ONE shared Zod schema. Also offers template download + JSON
 * upload (which just fills this same form state, then submits the normal way).
 */

type FinancialKey =
  | "defaultCurrency"
  | "machineCostPerMin"
  | "operatorCostPerMin"
  | "ratedRunningKw"
  | "idleKw"
  | "kwhRate"
  | "energyMultiplier"
  | "scrapCostPerUnit"
  | "rawMaterialCostPerUnit";

type ThresholdKey =
  | "stoppageMultiplier"
  | "macroStoppageMultiplier"
  | "oeeAlertThresholdPct"
  | "performanceThresholdPct"
  | "qualitySpikeDeltaPct";

const FINANCIAL_KEYS: FinancialKey[] = [
  "defaultCurrency",
  "machineCostPerMin",
  "operatorCostPerMin",
  "ratedRunningKw",
  "idleKw",
  "kwhRate",
  "energyMultiplier",
  "scrapCostPerUnit",
  "rawMaterialCostPerUnit",
];

const THRESHOLD_KEYS: ThresholdKey[] = [
  "stoppageMultiplier",
  "macroStoppageMultiplier",
  "oeeAlertThresholdPct",
  "performanceThresholdPct",
  "qualitySpikeDeltaPct",
];

type MachineRow = { name: string; code: string; location: string };
type ShiftRow = { name: string; startTime: string; endTime: string; enabled: boolean };
type ReasonItemRow = { name: string; codeSuffix: string };
type ReasonCategoryRow = {
  kind: OnboardingReasonKind;
  name: string;
  codePrefix: string;
  planned: boolean;
  items: ReasonItemRow[];
};
type ContactRow = { name: string; roleScope: string; email: string; phone: string };

type FormState = {
  org: { name: string; timezone: string };
  financial: Record<FinancialKey, string>;
  thresholds: Record<ThresholdKey, string>;
  machines: MachineRow[];
  shifts: ShiftRow[];
  reasonCategories: ReasonCategoryRow[];
  alertContacts: ContactRow[];
};

const emptyFinancial = (): Record<FinancialKey, string> =>
  Object.fromEntries(FINANCIAL_KEYS.map((k) => [k, ""])) as Record<FinancialKey, string>;
const emptyThresholds = (): Record<ThresholdKey, string> =>
  Object.fromEntries(THRESHOLD_KEYS.map((k) => [k, ""])) as Record<ThresholdKey, string>;

const emptyForm = (): FormState => ({
  org: { name: "", timezone: "UTC" },
  financial: emptyFinancial(),
  thresholds: emptyThresholds(),
  machines: [],
  shifts: [],
  reasonCategories: [],
  alertContacts: [],
});

const STEPS = ["company", "machines", "shifts", "costs", "reasons", "contacts", "review"] as const;
type Step = (typeof STEPS)[number];

type SubmitResult =
  | { ok: true; counts: Record<string, number | boolean> }
  | { ok: false; error: string; issues?: Array<{ path?: unknown; message?: string }> };

function num(value: string): number | undefined {
  if (value.trim() === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function buildPayload(form: FormState) {
  const financial: Record<string, unknown> = {};
  for (const k of FINANCIAL_KEYS) {
    const v = form.financial[k];
    if (v.trim() === "") continue;
    financial[k] = k === "defaultCurrency" ? v.trim() : num(v);
  }
  const thresholds: Record<string, number> = {};
  for (const k of THRESHOLD_KEYS) {
    const n = num(form.thresholds[k]);
    if (n !== undefined) thresholds[k] = n;
  }

  const payload: Record<string, unknown> = {};
  if (form.org.name.trim() || (form.org.timezone.trim() && form.org.timezone !== "UTC")) {
    payload.org = {
      ...(form.org.name.trim() ? { name: form.org.name.trim() } : {}),
      ...(form.org.timezone.trim() ? { timezone: form.org.timezone.trim() } : {}),
    };
  }
  if (Object.keys(financial).length) payload.financial = financial;
  if (Object.keys(thresholds).length) payload.thresholds = thresholds;

  const machines = form.machines
    .filter((m) => m.name.trim())
    .map((m) => ({ name: m.name.trim(), code: m.code.trim(), location: m.location.trim() }));
  if (machines.length) payload.machines = machines;

  const shifts = form.shifts.filter((s) => s.name.trim() && s.startTime && s.endTime);
  if (shifts.length) payload.shifts = shifts;

  const reasonCategories = form.reasonCategories
    .filter((c) => c.name.trim() && c.codePrefix.trim())
    .map((c) => ({
      kind: c.kind,
      name: c.name.trim(),
      codePrefix: c.codePrefix.trim(),
      planned: c.planned,
      items: c.items
        .filter((it) => it.name.trim() && it.codeSuffix.trim())
        .map((it) => ({ name: it.name.trim(), codeSuffix: it.codeSuffix.trim() })),
    }));
  if (reasonCategories.length) payload.reasonCategories = reasonCategories;

  const alertContacts = form.alertContacts
    .filter((c) => c.name.trim() && c.roleScope.trim() && (c.email.trim() || c.phone.trim()))
    .map((c) => ({
      name: c.name.trim(),
      roleScope: c.roleScope.trim(),
      email: c.email.trim(),
      phone: c.phone.trim(),
    }));
  if (alertContacts.length) payload.alertContacts = alertContacts;

  return payload;
}

const card = "rounded-2xl border border-white/10 bg-white/5 p-5";
const input =
  "w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white placeholder:text-zinc-500";
const labelCls = "block text-xs text-zinc-400";
const btn = "rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white hover:bg-white/10";
const btnPrimary =
  "rounded-xl border border-emerald-400/40 bg-emerald-500/20 px-4 py-2 text-sm text-emerald-100 hover:bg-emerald-500/30 disabled:cursor-not-allowed disabled:opacity-60";
const btnGhost = "rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-white hover:bg-white/10";

/** Generic add/remove list editor. Module-scope so its component identity is
 *  stable across renders (a nested definition would remount and drop input focus
 *  on every keystroke). */
function RowEditor<Row>(props: {
  rows: Row[];
  onChange: (rows: Row[]) => void;
  makeEmpty: () => Row;
  render: (row: Row, update: (patch: Partial<Row>) => void) => React.ReactNode;
  addLabel: string;
  emptyLabel: string;
  removeLabel: string;
  small?: boolean;
}) {
  const { rows, onChange, makeEmpty, render, addLabel, emptyLabel, removeLabel, small } = props;
  return (
    <div className="space-y-3">
      {rows.length === 0 && <div className="text-xs text-zinc-500">{emptyLabel}</div>}
      {rows.map((row, idx) => (
        <div key={idx} className={`flex items-start gap-2 rounded-xl border border-white/10 bg-black/20 ${small ? "p-2" : "p-3"}`}>
          <div className="flex-1">
            {render(row, (patch) => onChange(rows.map((r, i) => (i === idx ? { ...r, ...patch } : r))))}
          </div>
          <button type="button" className={btnGhost} onClick={() => onChange(rows.filter((_, i) => i !== idx))}>
            {removeLabel}
          </button>
        </div>
      ))}
      <button type="button" className={btn} onClick={() => onChange([...rows, makeEmpty()])}>
        {addLabel}
      </button>
    </div>
  );
}

export default function OnboardingPage() {
  const { t } = useI18n();
  const [form, setForm] = useState<FormState>(emptyForm);
  const [step, setStep] = useState<Step>("company");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const tt = useCallback(
    (key: string, fallback: string, vars?: Record<string, string | number>) => {
      const label = t(key, vars);
      return label === key ? fallback : label;
    },
    [t]
  );

  // Prefill from current org so a partial config can be topped up.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/onboarding/import", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        const snap = data?.snapshot;
        if (cancelled || !snap) return;
        setForm((prev) => ({
          org: { name: snap.org?.name ?? "", timezone: snap.org?.timezone ?? "UTC" },
          financial: {
            ...prev.financial,
            ...Object.fromEntries(
              FINANCIAL_KEYS.map((k) => [k, snap.financial?.[k] != null ? String(snap.financial[k]) : ""])
            ),
          } as Record<FinancialKey, string>,
          thresholds: {
            ...prev.thresholds,
            ...Object.fromEntries(
              THRESHOLD_KEYS.map((k) => [k, snap.thresholds?.[k] != null ? String(snap.thresholds[k]) : ""])
            ),
          } as Record<ThresholdKey, string>,
          machines: Array.isArray(snap.machines)
            ? snap.machines.map((m: MachineRow) => ({ name: m.name ?? "", code: m.code ?? "", location: m.location ?? "" }))
            : [],
          shifts: Array.isArray(snap.shifts)
            ? snap.shifts.map((s: ShiftRow) => ({
                name: s.name ?? "",
                startTime: s.startTime ?? "06:00",
                endTime: s.endTime ?? "14:00",
                enabled: s.enabled !== false,
              }))
            : [],
          reasonCategories: Array.isArray(snap.reasonCategories)
            ? snap.reasonCategories.map((c: ReasonCategoryRow) => ({
                kind: ONBOARDING_REASON_KINDS.includes(c.kind) ? c.kind : "downtime",
                name: c.name ?? "",
                codePrefix: c.codePrefix ?? "",
                planned: c.planned === true,
                items: Array.isArray(c.items)
                  ? c.items.map((it) => ({ name: it.name ?? "", codeSuffix: it.codeSuffix ?? "" }))
                  : [],
              }))
            : [],
          alertContacts: Array.isArray(snap.alertContacts)
            ? snap.alertContacts.map((c: ContactRow) => ({
                name: c.name ?? "",
                roleScope: c.roleScope ?? "",
                email: c.email ?? "",
                phone: c.phone ?? "",
              }))
            : [],
        }));
      } catch {
        /* prefill is best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const payloadPreview = useMemo(() => buildPayload(form), [form]);

  const onUpload = useCallback(async (file: File) => {
    setUploadError(null);
    try {
      const text = await file.text();
      const json = JSON.parse(text);
      setForm((prev) => ({
        org: { name: json.org?.name ?? prev.org.name, timezone: json.org?.timezone ?? prev.org.timezone },
        financial: {
          ...prev.financial,
          ...Object.fromEntries(
            FINANCIAL_KEYS.map((k) => [k, json.financial?.[k] != null ? String(json.financial[k]) : prev.financial[k]])
          ),
        } as Record<FinancialKey, string>,
        thresholds: {
          ...prev.thresholds,
          ...Object.fromEntries(
            THRESHOLD_KEYS.map((k) => [k, json.thresholds?.[k] != null ? String(json.thresholds[k]) : prev.thresholds[k]])
          ),
        } as Record<ThresholdKey, string>,
        machines: Array.isArray(json.machines)
          ? json.machines.map((m: Partial<MachineRow>) => ({ name: m.name ?? "", code: m.code ?? "", location: m.location ?? "" }))
          : prev.machines,
        shifts: Array.isArray(json.shifts)
          ? json.shifts.map((s: Partial<ShiftRow>) => ({
              name: s.name ?? "",
              startTime: s.startTime ?? "06:00",
              endTime: s.endTime ?? "14:00",
              enabled: s.enabled !== false,
            }))
          : prev.shifts,
        reasonCategories: Array.isArray(json.reasonCategories)
          ? json.reasonCategories.map((c: Partial<ReasonCategoryRow>) => ({
              kind: c.kind && ONBOARDING_REASON_KINDS.includes(c.kind) ? c.kind : "downtime",
              name: c.name ?? "",
              codePrefix: c.codePrefix ?? "",
              planned: c.planned === true,
              items: Array.isArray(c.items)
                ? c.items.map((it: Partial<ReasonItemRow>) => ({ name: it.name ?? "", codeSuffix: it.codeSuffix ?? "" }))
                : [],
            }))
          : prev.reasonCategories,
        alertContacts: Array.isArray(json.alertContacts)
          ? json.alertContacts.map((c: Partial<ContactRow>) => ({
              name: c.name ?? "",
              roleScope: c.roleScope ?? "",
              email: c.email ?? "",
              phone: c.phone ?? "",
            }))
          : prev.alertContacts,
      }));
      setStep("review");
    } catch {
      setUploadError(tt("onboarding.upload.parseError", "Could not read that file — make sure it's the JSON template."));
    }
  }, [tt]);

  const submit = useCallback(async () => {
    setSubmitting(true);
    setResult(null);
    try {
      const res = await fetch("/api/onboarding/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload(form)),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.ok) {
        setResult({ ok: false, error: data?.error ?? tt("onboarding.submit.failed", "Import failed"), issues: data?.issues });
      } else {
        setResult({ ok: true, counts: data.counts });
      }
    } catch {
      setResult({ ok: false, error: tt("onboarding.submit.failed", "Import failed") });
    } finally {
      setSubmitting(false);
    }
  }, [form, tt]);

  const stepIndex = STEPS.indexOf(step);

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">{tt("onboarding.title", "Company setup")}</h1>
          <p className="text-sm text-zinc-400">
            {tt("onboarding.subtitle", "Provision machines, cost rates, shifts, reasons and contacts in one pass.")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <a href="/api/onboarding/template" className={btn}>
            {tt("onboarding.downloadTemplate", "Download template")}
          </a>
          <label className={`${btn} cursor-pointer`}>
            {tt("onboarding.uploadTemplate", "Upload template")}
            <input
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onUpload(f);
                e.target.value = "";
              }}
            />
          </label>
        </div>
      </div>

      {uploadError && (
        <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{uploadError}</div>
      )}

      {/* Stepper */}
      <div className="mb-6 flex flex-wrap gap-2 rounded-2xl border border-white/10 bg-white/5 p-2">
        {STEPS.map((s, i) => (
          <button
            key={s}
            type="button"
            onClick={() => setStep(s)}
            className={
              s === step
                ? "rounded-xl bg-emerald-500/20 px-3 py-2 text-sm text-emerald-200"
                : "rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-200 hover:bg-white/10"
            }
          >
            {i + 1}. {tt(`onboarding.step.${s}`, s)}
          </button>
        ))}
      </div>

      {step === "company" && (
        <div className={card}>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <label className={labelCls}>
              {tt("onboarding.company.name", "Company / plant name")}
              <input
                className={`mt-2 ${input}`}
                value={form.org.name}
                onChange={(e) => setForm((p) => ({ ...p, org: { ...p.org, name: e.target.value } }))}
              />
            </label>
            <label className={labelCls}>
              {tt("onboarding.company.timezone", "Timezone (IANA)")}
              <input
                className={`mt-2 ${input}`}
                placeholder="America/Mexico_City"
                value={form.org.timezone}
                onChange={(e) => setForm((p) => ({ ...p, org: { ...p.org, timezone: e.target.value } }))}
              />
            </label>
          </div>
        </div>
      )}

      {step === "machines" && (
        <div className={card}>
          <RowEditor
            rows={form.machines}
            onChange={(machines) => setForm((p) => ({ ...p, machines }))}
            makeEmpty={() => ({ name: "", code: "", location: "" })}
            addLabel={tt("onboarding.machines.add", "Add machine")}
            emptyLabel={tt("onboarding.machines.empty", "No machines yet.")}
            removeLabel={tt("onboarding.row.remove", "Remove")}
            render={(row, update) => (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <input className={input} placeholder={tt("onboarding.machines.name", "Name")} value={row.name} onChange={(e) => update({ name: e.target.value })} />
                <input className={input} placeholder={tt("onboarding.machines.code", "Code")} value={row.code} onChange={(e) => update({ code: e.target.value })} />
                <input className={input} placeholder={tt("onboarding.machines.location", "Location")} value={row.location} onChange={(e) => update({ location: e.target.value })} />
              </div>
            )}
          />
        </div>
      )}

      {step === "shifts" && (
        <div className={card}>
          <p className="mb-3 text-xs text-zinc-400">{tt("onboarding.shifts.hint", "Uploading shifts replaces the current schedule.")}</p>
          <RowEditor
            rows={form.shifts}
            onChange={(shifts) => setForm((p) => ({ ...p, shifts }))}
            makeEmpty={() => ({ name: "", startTime: "06:00", endTime: "14:00", enabled: true })}
            addLabel={tt("onboarding.shifts.add", "Add shift")}
            emptyLabel={tt("onboarding.shifts.empty", "No shifts yet.")}
            removeLabel={tt("onboarding.row.remove", "Remove")}
            render={(row, update) => (
              <div className="grid grid-cols-1 items-center gap-2 sm:grid-cols-4">
                <input className={input} placeholder={tt("onboarding.shifts.name", "Name")} value={row.name} onChange={(e) => update({ name: e.target.value })} />
                <input className={input} type="time" value={row.startTime} onChange={(e) => update({ startTime: e.target.value })} />
                <input className={input} type="time" value={row.endTime} onChange={(e) => update({ endTime: e.target.value })} />
                <label className="flex items-center gap-2 text-xs text-zinc-400">
                  <input type="checkbox" checked={row.enabled} onChange={(e) => update({ enabled: e.target.checked })} className="h-4 w-4 rounded border border-white/20 bg-black/20" />
                  {tt("onboarding.shifts.enabled", "Enabled")}
                </label>
              </div>
            )}
          />
        </div>
      )}

      {step === "costs" && (
        <div className="space-y-6">
          <div className={card}>
            <div className="mb-3 text-sm font-semibold text-white">{tt("onboarding.costs.title", "Cost rates")}</div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {FINANCIAL_KEYS.map((k) => (
                <label key={k} className={labelCls}>
                  {tt(`onboarding.costs.${k}`, k)}
                  <input
                    className={`mt-2 ${input}`}
                    inputMode={k === "defaultCurrency" ? "text" : "decimal"}
                    value={form.financial[k]}
                    onChange={(e) => setForm((p) => ({ ...p, financial: { ...p.financial, [k]: e.target.value } }))}
                  />
                </label>
              ))}
            </div>
          </div>
          <div className={card}>
            <div className="mb-3 text-sm font-semibold text-white">{tt("onboarding.thresholds.title", "Alert thresholds")}</div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {THRESHOLD_KEYS.map((k) => (
                <label key={k} className={labelCls}>
                  {tt(`onboarding.thresholds.${k}`, k)}
                  <input
                    className={`mt-2 ${input}`}
                    inputMode="decimal"
                    value={form.thresholds[k]}
                    onChange={(e) => setForm((p) => ({ ...p, thresholds: { ...p.thresholds, [k]: e.target.value } }))}
                  />
                </label>
              ))}
            </div>
          </div>
        </div>
      )}

      {step === "reasons" && (
        <div className={card}>
          <RowEditor
            rows={form.reasonCategories}
            onChange={(reasonCategories) => setForm((p) => ({ ...p, reasonCategories }))}
            makeEmpty={(): ReasonCategoryRow => ({ kind: "downtime", name: "", codePrefix: "", planned: false, items: [] })}
            addLabel={tt("onboarding.reasons.addCategory", "Add category")}
            emptyLabel={tt("onboarding.reasons.empty", "No reason categories yet.")}
            removeLabel={tt("onboarding.row.remove", "Remove")}
            render={(row, update) => (
              <div className="space-y-3">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
                  <select className={input} value={row.kind} onChange={(e) => update({ kind: e.target.value as OnboardingReasonKind })}>
                    {ONBOARDING_REASON_KINDS.map((kind) => (
                      <option key={kind} value={kind}>{tt(`onboarding.reasons.kind.${kind}`, kind)}</option>
                    ))}
                  </select>
                  <input className={input} placeholder={tt("onboarding.reasons.name", "Category name")} value={row.name} onChange={(e) => update({ name: e.target.value })} />
                  <input className={input} placeholder={tt("onboarding.reasons.prefix", "Code prefix")} value={row.codePrefix} onChange={(e) => update({ codePrefix: e.target.value.toUpperCase() })} />
                  <label className="flex items-center gap-2 text-xs text-zinc-400">
                    <input type="checkbox" checked={row.planned} onChange={(e) => update({ planned: e.target.checked })} className="h-4 w-4 rounded border border-white/20 bg-black/20" />
                    {tt("onboarding.reasons.planned", "Planned")}
                  </label>
                </div>
                <div className="rounded-lg border border-white/10 bg-black/20 p-3">
                  <RowEditor
                    rows={row.items}
                    onChange={(items) => update({ items })}
                    makeEmpty={() => ({ name: "", codeSuffix: "" })}
                    addLabel={tt("onboarding.reasons.addItem", "Add reason")}
                    emptyLabel={tt("onboarding.reasons.noItems", "No reasons in this category.")}
                    removeLabel={tt("onboarding.row.remove", "Remove")}
                    small
                    render={(item, updateItem) => (
                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        <input className={input} placeholder={tt("onboarding.reasons.itemName", "Reason name")} value={item.name} onChange={(e) => updateItem({ name: e.target.value })} />
                        <input className={input} placeholder={tt("onboarding.reasons.suffix", "Suffix (digits)")} value={item.codeSuffix} onChange={(e) => updateItem({ codeSuffix: e.target.value })} />
                      </div>
                    )}
                  />
                </div>
              </div>
            )}
          />
        </div>
      )}

      {step === "contacts" && (
        <div className={card}>
          <p className="mb-3 text-xs text-zinc-400">{tt("onboarding.contacts.hint", "Each contact needs an email or a phone.")}</p>
          <RowEditor
            rows={form.alertContacts}
            onChange={(alertContacts) => setForm((p) => ({ ...p, alertContacts }))}
            makeEmpty={() => ({ name: "", roleScope: "", email: "", phone: "" })}
            addLabel={tt("onboarding.contacts.add", "Add contact")}
            emptyLabel={tt("onboarding.contacts.empty", "No contacts yet.")}
            removeLabel={tt("onboarding.row.remove", "Remove")}
            render={(row, update) => (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-4">
                <input className={input} placeholder={tt("onboarding.contacts.name", "Name")} value={row.name} onChange={(e) => update({ name: e.target.value })} />
                <input className={input} placeholder={tt("onboarding.contacts.role", "Role")} value={row.roleScope} onChange={(e) => update({ roleScope: e.target.value })} />
                <input className={input} placeholder={tt("onboarding.contacts.email", "Email")} value={row.email} onChange={(e) => update({ email: e.target.value })} />
                <input className={input} placeholder={tt("onboarding.contacts.phone", "Phone")} value={row.phone} onChange={(e) => update({ phone: e.target.value })} />
              </div>
            )}
          />
        </div>
      )}

      {step === "review" && (
        <div className="space-y-4">
          <div className={card}>
            <div className="mb-3 text-sm font-semibold text-white">{tt("onboarding.review.title", "Review & provision")}</div>
            <ul className="grid grid-cols-2 gap-2 text-sm text-zinc-300 sm:grid-cols-3">
              <li>{tt("onboarding.review.machines", "Machines")}: {(payloadPreview.machines as unknown[] | undefined)?.length ?? 0}</li>
              <li>{tt("onboarding.review.shifts", "Shifts")}: {(payloadPreview.shifts as unknown[] | undefined)?.length ?? 0}</li>
              <li>{tt("onboarding.review.categories", "Reason categories")}: {(payloadPreview.reasonCategories as unknown[] | undefined)?.length ?? 0}</li>
              <li>{tt("onboarding.review.contacts", "Contacts")}: {(payloadPreview.alertContacts as unknown[] | undefined)?.length ?? 0}</li>
              <li>{tt("onboarding.review.financial", "Cost rates")}: {payloadPreview.financial ? "✓" : "—"}</li>
              <li>{tt("onboarding.review.thresholds", "Thresholds")}: {payloadPreview.thresholds ? "✓" : "—"}</li>
            </ul>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button type="button" onClick={submit} disabled={submitting} className={btnPrimary}>
                {submitting ? tt("onboarding.submit.sending", "Provisioning…") : tt("onboarding.submit.go", "Provision company")}
              </button>
            </div>
          </div>

          {result?.ok && (
            <div className="rounded-2xl border border-emerald-400/30 bg-emerald-500/10 p-4 text-sm text-emerald-100">
              {tt("onboarding.submit.success", "Provisioned successfully.")}
              <div className="mt-2 text-xs text-emerald-200/80">
                {tt("onboarding.review.machines", "Machines")}: {String(result.counts.machines ?? 0)} ·{" "}
                {tt("onboarding.review.categories", "Reason categories")}: {String(result.counts.reasonCategories ?? 0)} ·{" "}
                {tt("onboarding.review.contacts", "Contacts")}: {String(result.counts.alertContacts ?? 0)}
              </div>
            </div>
          )}
          {result && !result.ok && (
            <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
              <div>{result.error}</div>
              {result.issues && result.issues.length > 0 && (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-xs text-red-200/80">
                  {result.issues.slice(0, 12).map((iss, i) => (
                    <li key={i}>
                      {Array.isArray(iss.path) && iss.path.length ? `${iss.path.join(".")}: ` : ""}
                      {iss.message ?? JSON.stringify(iss)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <details className={card}>
            <summary className="cursor-pointer text-sm text-zinc-300">{tt("onboarding.review.viewJson", "View payload JSON")}</summary>
            <pre className="mt-3 max-h-96 overflow-auto rounded-lg bg-black/40 p-3 text-xs text-zinc-300">
              {JSON.stringify(payloadPreview, null, 2)}
            </pre>
          </details>
        </div>
      )}

      {/* Step nav */}
      <div className="mt-6 flex items-center justify-between">
        <button
          type="button"
          className={btn}
          disabled={stepIndex === 0}
          onClick={() => setStep(STEPS[Math.max(0, stepIndex - 1)])}
        >
          {tt("onboarding.nav.back", "Back")}
        </button>
        {step !== "review" ? (
          <button type="button" className={btnPrimary} onClick={() => setStep(STEPS[Math.min(STEPS.length - 1, stepIndex + 1)])}>
            {tt("onboarding.nav.next", "Next")}
          </button>
        ) : (
          <span />
        )}
      </div>
    </div>
  );
}
