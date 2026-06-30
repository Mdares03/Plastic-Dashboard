"use client";

import { useCallback, useEffect, useState } from "react";
import { useI18n } from "@/lib/i18n/useI18n";

type ReportType = "daily" | "weekly" | "roi";
type Frequency = "daily" | "weekly" | "monthly";

type Schedule = {
  reportType: ReportType;
  enabled: boolean;
  frequency: Frequency;
  recipients: string[];
  hourUtc: number;
  dayOfWeek: number | null;
  dayOfMonth: number | null;
  lastSentAt: string | null;
};

const REPORT_TYPES: ReportType[] = ["daily", "weekly", "roi"];
const FREQUENCIES: Frequency[] = ["daily", "weekly", "monthly"];
const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6];

function toRecipientsText(list: string[]): string {
  return list.join(", ");
}

function parseRecipientsText(text: string): string[] {
  return text
    .split(/[,\n;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function ReportScheduleConfig() {
  const { t, locale } = useI18n();
  const [schedules, setSchedules] = useState<Record<ReportType, Schedule> | null>(null);
  const [recipientText, setRecipientText] = useState<Record<ReportType, string>>(
    {} as Record<ReportType, string>
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [savingType, setSavingType] = useState<ReportType | null>(null);
  const [statusType, setStatusType] = useState<ReportType | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/reports/schedule", { cache: "no-store" });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.ok) throw new Error(data?.error || t("settings.reports.failedLoad"));
      setSchedules(data.schedules);
      const texts = {} as Record<ReportType, string>;
      for (const type of REPORT_TYPES) {
        texts[type] = toRecipientsText(data.schedules[type]?.recipients ?? []);
      }
      setRecipientText(texts);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("settings.reports.failedLoad"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  const patch = useCallback((type: ReportType, next: Partial<Schedule>) => {
    setSchedules((prev) => (prev ? { ...prev, [type]: { ...prev[type], ...next } } : prev));
  }, []);

  const save = useCallback(
    async (type: ReportType) => {
      if (!schedules) return;
      setSavingType(type);
      setStatusType(null);
      setError(null);
      try {
        const s = schedules[type];
        const res = await fetch("/api/reports/schedule", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            reportType: type,
            enabled: s.enabled,
            frequency: s.frequency,
            recipients: parseRecipientsText(recipientText[type] ?? ""),
            hourUtc: s.hourUtc,
            dayOfWeek: s.dayOfWeek,
            dayOfMonth: s.dayOfMonth,
          }),
        });
        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.ok) throw new Error(data?.error || t("settings.reports.failedSave"));
        setSchedules((prev) => (prev ? { ...prev, [type]: data.schedule } : prev));
        setRecipientText((prev) => ({ ...prev, [type]: toRecipientsText(data.schedule.recipients) }));
        setStatusType(type);
      } catch (err) {
        setError(err instanceof Error ? err.message : t("settings.reports.failedSave"));
      } finally {
        setSavingType(null);
      }
    },
    [schedules, recipientText, t]
  );

  if (loading && !schedules) {
    return <div className="text-sm text-zinc-400">{t("settings.reports.loading")}</div>;
  }
  if (!schedules) {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-200">
        {error || t("settings.reports.failedLoad")}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-200">{error}</div>
      )}
      {REPORT_TYPES.map((type) => {
        const s = schedules[type];
        return (
          <div key={type} className="rounded-2xl border border-white/10 bg-black/20 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-white">{t(`settings.reports.type.${type}`)}</div>
                <div className="text-xs text-zinc-400">{t(`settings.reports.typeHelper.${type}`)}</div>
              </div>
              <button
                type="button"
                onClick={() => patch(type, { enabled: !s.enabled })}
                className={`h-6 w-12 shrink-0 rounded-full border border-white/10 p-0.5 transition ${
                  s.enabled ? "bg-emerald-500/20" : "bg-white/5"
                }`}
                aria-pressed={s.enabled}
              >
                <span
                  className={`block h-5 w-5 rounded-full transition ${
                    s.enabled ? "translate-x-6 bg-emerald-400" : "bg-zinc-500"
                  }`}
                />
              </button>
            </div>

            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
              <label className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-zinc-400">
                {t("settings.reports.frequency")}
                <select
                  value={s.frequency}
                  onChange={(e) => patch(type, { frequency: e.target.value as Frequency })}
                  className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
                >
                  {FREQUENCIES.map((f) => (
                    <option key={f} value={f}>
                      {t(`settings.reports.frequencyOption.${f}`)}
                    </option>
                  ))}
                </select>
              </label>

              <label className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-zinc-400">
                {t("settings.reports.hourUtc")}
                <input
                  type="number"
                  min={0}
                  max={23}
                  value={s.hourUtc}
                  onChange={(e) => patch(type, { hourUtc: Number(e.target.value) })}
                  className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
                />
              </label>

              {s.frequency === "weekly" && (
                <label className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-zinc-400">
                  {t("settings.reports.dayOfWeek")}
                  <select
                    value={s.dayOfWeek ?? 1}
                    onChange={(e) => patch(type, { dayOfWeek: Number(e.target.value) })}
                    className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
                  >
                    {WEEKDAYS.map((d) => (
                      <option key={d} value={d}>
                        {t(`settings.reports.weekday.${d}`)}
                      </option>
                    ))}
                  </select>
                </label>
              )}

              {s.frequency === "monthly" && (
                <label className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-zinc-400">
                  {t("settings.reports.dayOfMonth")}
                  <input
                    type="number"
                    min={1}
                    max={28}
                    value={s.dayOfMonth ?? 1}
                    onChange={(e) => patch(type, { dayOfMonth: Number(e.target.value) })}
                    className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
                  />
                </label>
              )}
            </div>

            <label className="mt-3 block rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-zinc-400">
              {t("settings.reports.recipients")}
              <textarea
                value={recipientText[type] ?? ""}
                onChange={(e) => setRecipientText((prev) => ({ ...prev, [type]: e.target.value }))}
                placeholder={t("settings.reports.recipientsPlaceholder")}
                rows={2}
                className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
              />
              <span className="mt-1 block text-[11px] text-zinc-500">
                {t("settings.reports.recipientsHint")}
              </span>
            </label>

            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => save(type)}
                disabled={savingType === type}
                className="rounded-xl border border-emerald-400/40 bg-emerald-500/20 px-4 py-2 text-sm text-emerald-100 hover:bg-emerald-500/30 disabled:opacity-60"
              >
                {savingType === type ? t("settings.reports.saving") : t("settings.reports.save")}
              </button>
              {statusType === type && (
                <span className="text-xs text-emerald-300">{t("settings.reports.saved")}</span>
              )}
              {s.lastSentAt && (
                <span className="text-[11px] text-zinc-500">
                  {t("settings.reports.lastSent", {
                    date: new Date(s.lastSentAt).toLocaleString(locale),
                  })}
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
