"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  closestCorners,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useI18n } from "@/lib/i18n/useI18n";
import ActionModal from "@/components/downtime/ActionModal";
import ActionCard from "@/components/actionItems/ActionCard";
import {
  ACTION_STATUSES,
  deleteActionRequest,
  isDueSoon,
  isOverdue,
  listActions,
  listMembers,
  newActionItem,
  saveActionRequest,
  type ActionItem,
  type ActionStatus,
  type MemberOption,
} from "@/lib/downtime/actions";

function cn(...xs: Array<string | false | null | undefined>) {
  return xs.filter(Boolean).join(" ");
}

type MachineOption = { id: string; name: string | null };

const COLUMN_ACCENT: Record<ActionStatus, string> = {
  open: "border-amber-500/20",
  in_progress: "border-sky-500/20",
  blocked: "border-rose-500/20",
  done: "border-emerald-500/20",
};

/** A column that accepts dropped cards. `id` is the target status. */
function DroppableColumn({
  status,
  isActiveTarget,
  children,
}: {
  status: ActionStatus;
  isActiveTarget: boolean;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex min-h-[120px] flex-1 flex-col gap-3 rounded-2xl p-1 transition",
        (isOver || isActiveTarget) && "bg-emerald-500/5 ring-1 ring-emerald-400/30"
      )}
    >
      {children}
    </div>
  );
}

/** Wraps ActionCard with a drag handle bound to dnd-kit. */
function DraggableCard({
  action,
  machineName,
  onEdit,
  onMove,
  canMoveLeft,
  canMoveRight,
}: {
  action: ActionItem;
  machineName: string | null;
  onEdit: () => void;
  onMove: (dir: -1 | 1) => void;
  canMoveLeft: boolean;
  canMoveRight: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: action.id });
  const style = transform
    ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`, zIndex: 50 }
    : undefined;
  return (
    <div ref={setNodeRef} style={style}>
      <ActionCard
        action={action}
        machineName={machineName}
        onEdit={onEdit}
        onMove={onMove}
        canMoveLeft={canMoveLeft}
        canMoveRight={canMoveRight}
        dragHandleProps={{ ...attributes, ...listeners }}
        isDragging={isDragging}
      />
    </div>
  );
}

export default function ActionItemsClient() {
  const { t } = useI18n();

  const [items, setItems] = useState<ActionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [members, setMembers] = useState<MemberOption[]>([]);
  const [machines, setMachines] = useState<MachineOption[]>([]);
  const [meId, setMeId] = useState<string | null>(null);

  // Filters (all client-side)
  const [ownerFilter, setOwnerFilter] = useState<string>("all");
  const [machineFilter, setMachineFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [mine, setMine] = useState(false);

  // Modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ActionItem | null>(null);

  // Drag-and-drop
  const [activeId, setActiveId] = useState<string | null>(null);
  const sensors = useSensors(
    // Small activation distance so taps on the card's buttons still register as clicks.
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor)
  );

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      const res = await listActions();
      if (!alive) return;
      if (!res.ok) {
        setError(res.error || t("downtime.actions.loadFailed"));
        setItems([]);
      } else {
        setItems(res.actions ?? []);
      }
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    let alive = true;
    (async () => {
      const res = await listMembers();
      if (alive && res.ok) setMembers(res.members ?? []);
    })();
    (async () => {
      try {
        const r = await fetch("/api/machines", { cache: "no-store" });
        const d = (await r.json().catch(() => ({}))) as { ok?: boolean; machines?: MachineOption[] };
        if (alive && r.ok && d.ok) {
          setMachines((d.machines ?? []).map((m) => ({ id: m.id, name: m.name })));
        }
      } catch {
        /* machine names are best-effort; cards fall back to id */
      }
    })();
    (async () => {
      try {
        const r = await fetch("/api/me", { cache: "no-store" });
        const d = (await r.json().catch(() => ({}))) as { ok?: boolean; user?: { id?: string } };
        if (alive && r.ok && d.ok) setMeId(d.user?.id ?? null);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const machineNameById = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const x of machines) m.set(x.id, x.name);
    return m;
  }, [machines]);

  const filtered = useMemo(() => {
    return items.filter((a) => {
      if (mine && meId && a.ownerUserId !== meId) return false;
      if (!mine && ownerFilter !== "all" && a.ownerUserId !== ownerFilter) return false;
      if (machineFilter !== "all" && a.machineId !== machineFilter) return false;
      if (priorityFilter !== "all" && a.priority !== priorityFilter) return false;
      return true;
    });
  }, [items, mine, meId, ownerFilter, machineFilter, priorityFilter]);

  const byStatus = useMemo(() => {
    const map: Record<ActionStatus, ActionItem[]> = { open: [], in_progress: [], blocked: [], done: [] };
    for (const a of filtered) map[a.status]?.push(a);
    return map;
  }, [filtered]);

  // Summary tiles count the OPEN universe (everything not done) within the filter.
  const summary = useMemo(() => {
    const active = filtered.filter((a) => a.status !== "done");
    return {
      open: active.length,
      dueSoon: active.filter((a) => isDueSoon(a.dueDate)).length,
      overdue: active.filter((a) => isOverdue(a.dueDate)).length,
    };
  }, [filtered]);

  // Optimistic status change (used by both the move arrows and DnD).
  const moveTo = useCallback(
    async (action: ActionItem, status: ActionStatus) => {
      if (action.status === status) return;
      const prev = items;
      const next: ActionItem = { ...action, status, updatedAt: new Date().toISOString() };
      setItems((list) => list.map((x) => (x.id === action.id ? next : x)));
      const res = await saveActionRequest(next, false);
      if (!res.ok) {
        setItems(prev); // revert
        setError(res.error || t("downtime.action.updateFailed"));
        return;
      }
      if (res.action) setItems((list) => list.map((x) => (x.id === res.action!.id ? res.action! : x)));
    },
    [items, t]
  );

  const moveByOffset = useCallback(
    (action: ActionItem, dir: -1 | 1) => {
      const idx = ACTION_STATUSES.indexOf(action.status);
      const target = ACTION_STATUSES[idx + dir];
      if (target) void moveTo(action, target);
    },
    [moveTo]
  );

  const onDragStart = useCallback((e: DragStartEvent) => {
    setActiveId(String(e.active.id));
  }, []);

  const onDragEnd = useCallback(
    (e: DragEndEvent) => {
      setActiveId(null);
      const overId = e.over?.id;
      if (overId == null) return;
      const target = overId as ActionStatus;
      if (!ACTION_STATUSES.includes(target)) return;
      const action = items.find((x) => x.id === String(e.active.id));
      if (action && action.status !== target) void moveTo(action, target);
    },
    [items, moveTo]
  );

  const activeCard = activeId ? items.find((x) => x.id === activeId) ?? null : null;

  const onSave = useCallback(async (next: ActionItem, isNew: boolean) => {
    const res = await saveActionRequest(next, isNew);
    if (res.ok && res.action) {
      setItems((prev) => {
        if (isNew) return [res.action!, ...prev];
        const i = prev.findIndex((x) => x.id === res.action!.id);
        if (i === -1) return [res.action!, ...prev];
        const copy = [...prev];
        copy[i] = res.action!;
        return copy;
      });
    }
    return { ok: res.ok, error: res.error };
  }, []);

  const onDelete = useCallback(async (id: string) => {
    const res = await deleteActionRequest(id);
    if (res.ok) setItems((prev) => prev.filter((x) => x.id !== id));
    return { ok: res.ok, error: res.error };
  }, []);

  const openNew = () => {
    setEditing(null);
    setModalOpen(true);
  };
  const openEdit = (a: ActionItem) => {
    setEditing(a);
    setModalOpen(true);
  };

  return (
    <div className="p-4 sm:p-6">
      {/* Header */}
      <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-zinc-950/40 p-6 backdrop-blur-xl">
        <div
          className="pointer-events-none absolute inset-0 opacity-70"
          style={{
            background:
              "radial-gradient(900px 500px at 20% 10%, rgba(16,185,129,.18), transparent 60%)," +
              "radial-gradient(900px 500px at 85% 30%, rgba(59,130,246,.12), transparent 60%)," +
              "radial-gradient(900px 600px at 50% 100%, rgba(244,63,94,.10), transparent 60%)",
          }}
        />
        <div className="relative flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <div className="text-2xl font-semibold text-white">{t("actionItems.title")}</div>
            <div className="mt-1 text-sm text-zinc-300">{t("actionItems.subtitle")}</div>
          </div>
          <button
            onClick={openNew}
            className="shrink-0 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2 text-sm text-emerald-100 hover:bg-emerald-500/20"
          >
            {t("downtime.actions.new")}
          </button>
        </div>

        {/* Summary tiles */}
        <div className="relative mt-5 grid grid-cols-3 gap-3 sm:max-w-md">
          <div className="rounded-2xl border border-white/10 bg-black/20 p-3">
            <div className="text-[11px] text-zinc-300">{t("downtime.actions.open")}</div>
            <div className="mt-1 text-xl font-semibold text-white">{summary.open}</div>
          </div>
          <div className="rounded-2xl border border-amber-500/20 bg-black/20 p-3">
            <div className="text-[11px] text-zinc-300">{t("downtime.actions.dueSoon")}</div>
            <div className="mt-1 text-xl font-semibold text-white">{summary.dueSoon}</div>
          </div>
          <div className="rounded-2xl border border-rose-500/20 bg-black/20 p-3">
            <div className="text-[11px] text-zinc-300">{t("downtime.actions.overdue")}</div>
            <div className="mt-1 text-xl font-semibold text-white">{summary.overdue}</div>
          </div>
        </div>

        {/* Filters */}
        <div className="relative mt-5 flex flex-wrap items-center gap-2">
          <button
            onClick={() => setMine((v) => !v)}
            disabled={!meId}
            className={cn(
              "h-9 rounded-xl border px-3 text-xs",
              mine
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-100"
                : "border-white/10 bg-white/5 text-zinc-200 hover:bg-white/10",
              !meId && "opacity-40 cursor-not-allowed"
            )}
          >
            {t("actionItems.filter.mine")}
          </button>

          <select
            value={mine ? "all" : ownerFilter}
            disabled={mine}
            onChange={(e) => setOwnerFilter(e.target.value)}
            className="h-9 rounded-xl border border-white/10 bg-white/5 px-3 text-xs text-zinc-200 outline-none hover:bg-white/10 disabled:opacity-40"
          >
            <option value="all">{t("actionItems.filter.allOwners")}</option>
            {members.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name || m.email}
              </option>
            ))}
          </select>

          <select
            value={machineFilter}
            onChange={(e) => setMachineFilter(e.target.value)}
            className="h-9 rounded-xl border border-white/10 bg-white/5 px-3 text-xs text-zinc-200 outline-none hover:bg-white/10"
          >
            <option value="all">{t("actionItems.filter.allMachines")}</option>
            {machines.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name || m.id}
              </option>
            ))}
          </select>

          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            className="h-9 rounded-xl border border-white/10 bg-white/5 px-3 text-xs text-zinc-200 outline-none hover:bg-white/10"
          >
            <option value="all">{t("actionItems.filter.allPriorities")}</option>
            <option value="high">{t("downtime.priority.high")}</option>
            <option value="medium">{t("downtime.priority.medium")}</option>
            <option value="low">{t("downtime.priority.low")}</option>
          </select>
        </div>
      </div>

      {error ? (
        <div className="mt-6 rounded-2xl border border-rose-500/25 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      ) : null}

      {/* Board */}
      {loading ? (
        <div className="mt-6 text-sm text-zinc-300">{t("downtime.actions.loading")}</div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onDragCancel={() => setActiveId(null)}
        >
          <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            {ACTION_STATUSES.map((status) => {
              const colItems = byStatus[status];
              const idx = ACTION_STATUSES.indexOf(status);
              return (
                <div
                  key={status}
                  className={cn("flex flex-col rounded-3xl border bg-white/5 p-3", COLUMN_ACCENT[status])}
                >
                  <div className="flex items-center justify-between px-1 pb-3">
                    <div className="text-sm font-semibold text-white">{t(`downtime.status.${status}`)}</div>
                    <span className="rounded-full border border-white/10 bg-black/20 px-2 py-0.5 text-[11px] text-zinc-300">
                      {colItems.length}
                    </span>
                  </div>

                  <DroppableColumn status={status} isActiveTarget={Boolean(activeCard) && activeCard?.status !== status}>
                    {colItems.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-white/10 bg-black/10 p-4 text-center text-[11px] text-zinc-400">
                        {t("actionItems.empty")}
                      </div>
                    ) : (
                      colItems.map((a) => (
                        <DraggableCard
                          key={a.id}
                          action={a}
                          machineName={a.machineId ? machineNameById.get(a.machineId) ?? null : null}
                          onEdit={() => openEdit(a)}
                          onMove={(dir) => moveByOffset(a, dir)}
                          canMoveLeft={idx > 0}
                          canMoveRight={idx < ACTION_STATUSES.length - 1}
                        />
                      ))
                    )}
                  </DroppableColumn>
                </div>
              );
            })}
          </div>

          <DragOverlay>
            {activeCard ? (
              <ActionCard
                action={activeCard}
                machineName={activeCard.machineId ? machineNameById.get(activeCard.machineId) ?? null : null}
                onEdit={() => {}}
                onMove={() => {}}
                canMoveLeft={false}
                canMoveRight={false}
                isDragging
              />
            ) : null}
          </DragOverlay>
        </DndContext>
      )}

      <ActionModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        initial={editing ?? newActionItem({})}
        onSave={onSave}
        onDelete={onDelete}
        members={members}
        isNew={!editing}
      />
    </div>
  );
}
