"use client";

import React from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, GripVertical } from "lucide-react";
import { useI18n } from "@/lib/i18n/useI18n";
import {
  isDueSoon,
  isOverdue,
  priorityPill,
  type ActionItem,
} from "@/lib/downtime/actions";

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

function initials(name?: string | null, email?: string | null) {
  const src = (name || email || "").trim();
  if (!src) return "—";
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

/** Build the deep-link back to the Downtime page for a card's machine/reason. */
function downtimeHref(action: ActionItem): string | null {
  const params = new URLSearchParams();
  if (action.machineId) params.set("machineId", action.machineId);
  if (action.reasonCode) params.set("reasonCode", action.reasonCode);
  if (action.hmDay != null && action.hmHour != null) {
    params.set("hmDay", String(action.hmDay));
    params.set("hmHour", String(action.hmHour));
  }
  const qs = params.toString();
  return qs ? `/downtime?${qs}` : null;
}

export default function ActionCard({
  action,
  machineName,
  onEdit,
  onMove,
  canMoveLeft,
  canMoveRight,
  /** Optional drag handle props (wired by the kanban when DnD is enabled). */
  dragHandleProps,
  isDragging,
}: {
  action: ActionItem;
  machineName?: string | null;
  onEdit: () => void;
  onMove: (dir: -1 | 1) => void;
  canMoveLeft: boolean;
  canMoveRight: boolean;
  dragHandleProps?: Record<string, unknown>;
  isDragging?: boolean;
}) {
  const { t, locale } = useI18n();

  const overdue = isOverdue(action.dueDate);
  const dueSoon = !overdue && isDueSoon(action.dueDate);
  const href = downtimeHref(action);
  const contextLabel = machineName || action.machineId || action.reasonCode;

  return (
    <div
      className={cn(
        "rounded-2xl border border-white/10 bg-white/5 p-3 transition",
        isDragging ? "opacity-60 ring-2 ring-emerald-400/40" : "hover:bg-white/[0.07]"
      )}
    >
      <div className="flex items-start gap-2">
        {dragHandleProps ? (
          <button
            {...dragHandleProps}
            type="button"
            aria-label={t("actionItems.dragHandle")}
            className="mt-0.5 cursor-grab touch-none rounded-md p-1 text-zinc-400 hover:bg-white/10 hover:text-zinc-200 active:cursor-grabbing"
          >
            <GripVertical className="h-4 w-4" />
          </button>
        ) : null}

        <button onClick={onEdit} className="min-w-0 flex-1 text-left">
          <div className="truncate text-sm font-medium text-white">
            {action.title || t("downtime.actions.untitled")}
          </div>
        </button>

        <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-[10px]", priorityPill(action.priority))}>
          {t(`downtime.priority.${action.priority}`)}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
        <span className="inline-flex items-center gap-1.5 text-zinc-300">
          <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-white/10 bg-black/30 text-[9px] font-semibold text-zinc-200">
            {initials(action.ownerName, action.ownerEmail)}
          </span>
          <span className="max-w-[120px] truncate">
            {action.ownerName || action.ownerEmail || t("downtime.action.unassigned")}
          </span>
        </span>

        {action.dueDate ? (
          <span
            className={cn(
              "rounded-full border px-2 py-0.5",
              overdue
                ? "border-rose-500/30 bg-rose-500/10 text-rose-200"
                : dueSoon
                ? "border-amber-500/30 bg-amber-500/10 text-amber-200"
                : "border-white/10 bg-white/5 text-zinc-300"
            )}
          >
            {overdue
              ? `${t("actionItems.overdue")} · ${new Date(action.dueDate).toLocaleDateString(locale)}`
              : dueSoon
              ? `${t("actionItems.dueSoon")} · ${new Date(action.dueDate).toLocaleDateString(locale)}`
              : t("downtime.actions.due", { date: new Date(action.dueDate).toLocaleDateString(locale) })}
          </span>
        ) : null}
      </div>

      {contextLabel ? (
        <div className="mt-2">
          {href ? (
            <Link
              href={href}
              prefetch={false}
              title={t("actionItems.openInDowntime")}
              className="inline-flex max-w-full items-center gap-1 truncate rounded-full border border-white/10 bg-black/20 px-2 py-0.5 text-[10px] text-zinc-300 hover:bg-white/10 hover:text-white"
            >
              <span className="truncate">{contextLabel}</span>
              {action.reasonCode && contextLabel !== action.reasonCode ? (
                <span className="text-zinc-400">· {action.reasonCode}</span>
              ) : null}
            </Link>
          ) : (
            <span className="inline-block rounded-full border border-white/10 bg-black/20 px-2 py-0.5 text-[10px] text-zinc-400">
              {contextLabel}
            </span>
          )}
        </div>
      ) : null}

      <div className="mt-3 flex items-center justify-between border-t border-white/5 pt-2">
        <button
          onClick={() => onMove(-1)}
          disabled={!canMoveLeft}
          aria-label={t("actionItems.moveLeft")}
          title={t("actionItems.moveLeft")}
          className="rounded-lg border border-white/10 bg-white/5 p-1 text-zinc-300 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <button onClick={onEdit} className="text-[11px] text-zinc-400 hover:text-zinc-200">
          {t("common.edit")}
        </button>
        <button
          onClick={() => onMove(1)}
          disabled={!canMoveRight}
          aria-label={t("actionItems.moveRight")}
          title={t("actionItems.moveRight")}
          className="rounded-lg border border-white/10 bg-white/5 p-1 text-zinc-300 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-30"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
