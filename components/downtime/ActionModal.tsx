"use client";

import React from "react";
import { useI18n } from "@/lib/i18n/useI18n";
import type { ActionItem, ActionPriority, ActionStatus, MemberOption } from "@/lib/downtime/actions";

/**
 * Create/edit modal for a downtime action item. Presentational only — the
 * parent owns the data and supplies onSave/onDelete (see lib/downtime/actions).
 * Shared by the Downtime page and the Action Items kanban.
 */
export default function ActionModal({
  open,
  onClose,
  initial,
  onSave,
  onDelete,
  members,
  isNew,
}: {
  open: boolean;
  onClose: () => void;
  initial: ActionItem;
  onSave: (a: ActionItem, isNew: boolean) => Promise<{ ok: boolean; error?: string | null }>;
  onDelete?: (id: string) => Promise<{ ok: boolean; error?: string | null }>;
  members: MemberOption[];
  isNew: boolean;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = React.useState<ActionItem>(initial);
  const [saving, setSaving] = React.useState(false);
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const availableMembers = React.useMemo(() => members, [members]);

  React.useEffect(() => {
    setDraft(initial);
    setSaveError(null);
  }, [initial]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="absolute left-1/2 top-1/2 w-[92vw] max-w-[560px] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-3xl border border-white/10 bg-zinc-950/80 backdrop-blur-xl">
        <div className="flex items-start justify-between gap-3 border-b border-white/10 p-5">
          <div className="min-w-0">
            <div className="text-sm font-semibold text-white">{t("downtime.action.title")}</div>
            <div className="mt-1 text-xs text-zinc-300">{t("downtime.action.subtitle")}</div>
          </div>
          <button
            onClick={onClose}
            className="rounded-xl border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white hover:bg-white/10"
          >
            {t("common.close")}
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <div className="text-[11px] text-zinc-400">{t("downtime.action.fieldTitle")}</div>
            <input
              value={draft.title}
              onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
              placeholder={t("downtime.action.titlePlaceholder")}
              className="mt-1 h-10 w-full rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white outline-none placeholder:text-zinc-400"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-[11px] text-zinc-400">{t("downtime.action.owner")}</div>
              <select
                value={draft.ownerUserId ?? ""}
                onChange={(e) =>
                  setDraft((d) => ({
                    ...d,
                    ownerUserId: e.target.value ? e.target.value : null,
                  }))
                }
                className="mt-1 h-10 w-full rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white outline-none"
              >
                <option value="">{t("downtime.action.unassigned")}</option>
                {availableMembers.map((member) => {
                  const label = member.name ? `${member.name} (${member.email})` : member.email;
                  const suffix = member.isActive ? "" : t("downtime.action.inactiveSuffix");
                  return (
                    <option key={member.id} value={member.id}>
                      {label}{suffix}
                    </option>
                  );
                })}
              </select>
            </div>

            <div>
              <div className="text-[11px] text-zinc-400">{t("downtime.action.dueDate")}</div>
              <input
                type="date"
                value={draft.dueDate ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, dueDate: e.target.value || null }))}
                className="mt-1 h-10 w-full rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white outline-none"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-[11px] text-zinc-400">{t("downtime.action.status")}</div>
              <select
                value={draft.status}
                onChange={(e) => setDraft((d) => ({ ...d, status: e.target.value as ActionStatus }))}
                className="mt-1 h-10 w-full rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white outline-none"
              >
                <option value="open">{t("downtime.status.open")}</option>
                <option value="in_progress">{t("downtime.status.in_progress")}</option>
                <option value="blocked">{t("downtime.status.blocked")}</option>
                <option value="done">{t("downtime.status.done")}</option>
              </select>
            </div>

            <div>
              <div className="text-[11px] text-zinc-400">{t("downtime.action.priority")}</div>
              <select
                value={draft.priority}
                onChange={(e) => setDraft((d) => ({ ...d, priority: e.target.value as ActionPriority }))}
                className="mt-1 h-10 w-full rounded-xl border border-white/10 bg-black/20 px-3 text-sm text-white outline-none"
              >
                <option value="low">{t("downtime.priority.low")}</option>
                <option value="medium">{t("downtime.priority.medium")}</option>
                <option value="high">{t("downtime.priority.high")}</option>
              </select>
            </div>
          </div>

          <div>
            <div className="text-[11px] text-zinc-400">{t("downtime.action.notes")}</div>
            <textarea
              value={draft.notes}
              onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
              placeholder={t("downtime.action.notesPlaceholder")}
              className="mt-1 h-24 w-full resize-none rounded-xl border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none placeholder:text-zinc-400"
            />
          </div>

          {saveError ? (
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
              {saveError}
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-2 text-[11px] text-zinc-300">
            {draft.machineId ? <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1">{t("downtime.action.chipMachine")}</span> : null}
            {draft.reasonCode ? <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1">{t("downtime.action.chipReason")}</span> : null}
            {draft.hmDay != null && draft.hmHour != null ? (
              <span className="rounded-full border border-white/10 bg-white/5 px-2 py-1">{t("downtime.action.chipHeatmap")}</span>
            ) : null}
          </div>

          <div className="flex items-center justify-between pt-2">
            <div>
              {onDelete && !isNew ? (
                <button
                  onClick={async () => {
                    if (!draft.id) return;
                    setSaving(true);
                    setSaveError(null);
                    const result = await onDelete(draft.id);
                    if (!result.ok) {
                      setSaveError(result.error || t("downtime.action.deleteFailed"));
                      setSaving(false);
                      return;
                    }
                    setSaving(false);
                    onClose();
                  }}
                  disabled={saving}
                  className="rounded-xl border border-rose-500/25 bg-rose-500/10 px-4 py-2 text-sm text-rose-200 hover:bg-rose-500/15 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {t("downtime.action.delete")}
                </button>
              ) : null}
            </div>

            <button
              onClick={async () => {
                setSaving(true);
                setSaveError(null);
                const now = new Date().toISOString();
                const next: ActionItem = { ...draft, updatedAt: now };
                const result = await onSave(next, isNew);
                if (!result.ok) {
                  setSaveError(result.error || t("downtime.action.saveFailed"));
                  setSaving(false);
                  return;
                }
                setSaving(false);
                onClose();
              }}
              disabled={saving}
              className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-100 hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {saving ? t("downtime.action.saving") : t("downtime.action.save")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
