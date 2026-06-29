/**
 * Shared downtime "action item" model + data helpers.
 *
 * Extracted from DowntimePageClient so the Downtime analysis page and the
 * standalone Action Items kanban page (/action-items) share one source of
 * truth for the ActionItem shape and the create/update/delete network calls.
 *
 * Helpers return the server-provided error string (or null on a network
 * failure) so the caller can localize a fallback with its own i18n `t()`.
 */

export type ActionStatus = "open" | "in_progress" | "blocked" | "done";
export type ActionPriority = "low" | "medium" | "high";

export const ACTION_STATUSES: ActionStatus[] = ["open", "in_progress", "blocked", "done"];

export type HeatmapSel = { day: number; hour: number };

export type ActionItem = {
  id: string;
  createdAt: string;
  updatedAt: string;

  machineId: string | null;
  reasonCode: string | null;
  hmDay: number | null;
  hmHour: number | null;

  title: string;
  notes: string;
  ownerUserId: string | null;
  ownerName: string | null;
  ownerEmail: string | null;
  dueDate: string | null; // YYYY-MM-DD
  status: ActionStatus;
  priority: ActionPriority;
};

export type MemberOption = {
  id: string;
  name?: string | null;
  email: string;
  role: string;
  isActive: boolean;
};

export type ActionMutationResult = {
  ok: boolean;
  action?: ActionItem;
  error?: string | null;
};

/** Tailwind classes for a status pill. */
export function statusPill(status: ActionStatus): string {
  switch (status) {
    case "done":
      return "border-emerald-500/25 bg-emerald-500/10 text-emerald-200";
    case "blocked":
      return "border-rose-500/25 bg-rose-500/10 text-rose-200";
    case "in_progress":
      return "border-sky-500/25 bg-sky-500/10 text-sky-200";
    default:
      return "border-amber-500/25 bg-amber-500/10 text-amber-200";
  }
}

/** Tailwind classes for a priority pill. */
export function priorityPill(p: ActionPriority): string {
  switch (p) {
    case "high":
      return "border-rose-500/25 bg-rose-500/10 text-rose-200";
    case "medium":
      return "border-yellow-500/25 bg-yellow-500/10 text-yellow-200";
    default:
      return "border-white/10 bg-white/5 text-zinc-200";
  }
}

export type ListActionsFilter = {
  machineId?: string | null;
  reasonCode?: string | null;
  hmDay?: number | null;
  hmHour?: number | null;
  status?: ActionStatus | null;
  ownerUserId?: string | null;
};

/** GET /api/downtime/actions (all filters optional; no params → all org actions). */
export async function listActions(
  filter: ListActionsFilter = {},
  signal?: AbortSignal
): Promise<{ ok: boolean; actions?: ActionItem[]; error?: string | null }> {
  const params = new URLSearchParams();
  if (filter.machineId) params.set("machineId", filter.machineId);
  if (filter.reasonCode) params.set("reasonCode", filter.reasonCode);
  if (filter.hmDay != null && filter.hmHour != null) {
    params.set("hmDay", String(filter.hmDay));
    params.set("hmHour", String(filter.hmHour));
  }
  if (filter.status) params.set("status", filter.status);
  if (filter.ownerUserId) params.set("ownerUserId", filter.ownerUserId);

  const qs = params.toString();
  try {
    const res = await fetch(`/api/downtime/actions${qs ? `?${qs}` : ""}`, {
      cache: "no-store",
      signal,
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      actions?: ActionItem[];
    };
    if (!res.ok || !data.ok) return { ok: false, error: data.error ?? null };
    return { ok: true, actions: Array.isArray(data.actions) ? data.actions : [] };
  } catch {
    return { ok: false, error: null };
  }
}

/** GET /api/org/members for the owner picker. */
export async function listMembers(
  signal?: AbortSignal
): Promise<{ ok: boolean; members?: MemberOption[]; error?: string | null }> {
  try {
    const res = await fetch("/api/org/members", { cache: "no-store", signal });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      members?: MemberOption[];
    };
    if (!res.ok || !data.ok) return { ok: false, error: data.error ?? null };
    return { ok: true, members: Array.isArray(data.members) ? data.members : [] };
  } catch {
    return { ok: false, error: null };
  }
}

/** POST (create) or PATCH (update) /api/downtime/actions. */
export async function saveActionRequest(next: ActionItem, isNew: boolean): Promise<ActionMutationResult> {
  const payload = {
    machineId: next.machineId,
    reasonCode: next.reasonCode,
    hmDay: next.hmDay,
    hmHour: next.hmHour,
    title: next.title.trim(),
    notes: next.notes.trim(),
    ownerUserId: next.ownerUserId,
    dueDate: next.dueDate,
    status: next.status,
    priority: next.priority,
  };
  const url = isNew ? "/api/downtime/actions" : `/api/downtime/actions/${next.id}`;
  try {
    const res = await fetch(url, {
      method: isNew ? "POST" : "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      error?: string;
      action?: ActionItem;
    };
    if (!res.ok || !data.ok || !data.action) {
      return { ok: false, error: data.error ?? null };
    }
    return { ok: true, action: data.action };
  } catch {
    return { ok: false, error: null };
  }
}

/** DELETE /api/downtime/actions/[id]. */
export async function deleteActionRequest(id: string): Promise<{ ok: boolean; error?: string | null }> {
  try {
    const res = await fetch(`/api/downtime/actions/${id}`, { method: "DELETE" });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!res.ok || !data.ok) return { ok: false, error: data.error ?? null };
    return { ok: true };
  } catch {
    return { ok: false, error: null };
  }
}

/** A blank action seeded with the given downtime context (machine/reason/heatmap). */
export function newActionItem(ctx: {
  machineId?: string | null;
  reasonCode?: string | null;
  hmDay?: number | null;
  hmHour?: number | null;
}): ActionItem {
  const ts = new Date().toISOString();
  return {
    id: "",
    createdAt: ts,
    updatedAt: ts,
    machineId: ctx.machineId ?? null,
    reasonCode: ctx.reasonCode ?? null,
    hmDay: ctx.hmDay ?? null,
    hmHour: ctx.hmHour ?? null,
    title: "",
    notes: "",
    ownerUserId: null,
    ownerName: null,
    ownerEmail: null,
    dueDate: null,
    status: "open",
    priority: "medium",
  };
}

/** True when a due date is in the past (date-only comparison, local time). */
export function isOverdue(dueDate: string | null, now: Date = new Date()): boolean {
  if (!dueDate) return false;
  const d = new Date(dueDate + "T00:00:00");
  return d.getTime() < new Date(now.toDateString()).getTime();
}

/** True when a due date is today..+3 days out. */
export function isDueSoon(dueDate: string | null, now: Date = new Date()): boolean {
  if (!dueDate) return false;
  const d = new Date(dueDate + "T00:00:00");
  const diffDays = (d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
  return diffDays >= 0 && diffDays <= 3;
}
