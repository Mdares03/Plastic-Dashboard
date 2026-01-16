"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/lib/i18n/useI18n";

type MachineRow = {
  id: string;
  name: string;
  location?: string | null;
};

type ShiftRow = {
  name: string;
  enabled: boolean;
};

type AlertEvent = {
  id: string;
  ts: string;
  eventType: string;
  severity: string;
  title: string;
  description?: string | null;
  machineId: string;
  machineName?: string | null;
  location?: string | null;
  workOrderId?: string | null;
  sku?: string | null;
  durationSec?: number | null;
  status?: string | null;
  shift?: string | null;
  alertId?: string | null;
  isUpdate?: boolean;
  isAutoAck?: boolean;
};

const RANGE_OPTIONS = [
  { value: "24h", labelKey: "alerts.inbox.range.24h" },
  { value: "7d", labelKey: "alerts.inbox.range.7d" },
  { value: "30d", labelKey: "alerts.inbox.range.30d" },
  { value: "custom", labelKey: "alerts.inbox.range.custom" },
] as const;

function formatDuration(seconds: number | null | undefined, t: (key: string) => string) {
  if (seconds == null || !Number.isFinite(seconds)) return t("alerts.inbox.duration.na");
  if (seconds < 60) return `${Math.round(seconds)}${t("alerts.inbox.duration.sec")}`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}${t("alerts.inbox.duration.min")}`;
  return `${(seconds / 3600).toFixed(1)}${t("alerts.inbox.duration.hr")}`;
}

function normalizeLabel(value?: string | null) {
  if (!value) return "";
  return String(value).trim();
}

export default function AlertsClient({
  initialMachines = [],
  initialShifts = [],
  initialEvents = [],
}: {
  initialMachines?: MachineRow[];
  initialShifts?: ShiftRow[];
  initialEvents?: AlertEvent[];
}) {
  const { t, locale } = useI18n();
  const [events, setEvents] = useState<AlertEvent[]>(() => initialEvents);
  const [machines, setMachines] = useState<MachineRow[]>(() => initialMachines);
  const [shifts, setShifts] = useState<ShiftRow[]>(() => initialShifts);
  const [loading, setLoading] = useState(() => initialMachines.length === 0 || initialShifts.length === 0);
  const [loadingEvents, setLoadingEvents] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<string>("24h");
  const [start, setStart] = useState<string>("");
  const [end, setEnd] = useState<string>("");
  const [machineId, setMachineId] = useState<string>("");
  const [location, setLocation] = useState<string>("");
  const [shift, setShift] = useState<string>("");
  const [eventType, setEventType] = useState<string>("");
  const [severity, setSeverity] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [includeUpdates, setIncludeUpdates] = useState(false);
  const [search, setSearch] = useState("");
  const skipInitialEventsRef = useRef(true);

  const locations = useMemo(() => {
    const seen = new Set<string>();
    for (const machine of machines) {
      if (!machine.location) continue;
      seen.add(machine.location);
    }
    return Array.from(seen).sort();
  }, [machines]);

  useEffect(() => {
    if (initialMachines.length && initialShifts.length) {
      setLoading(false);
      return;
    }
    let alive = true;

    async function loadFilters() {
      setLoading(true);
      try {
        const [machinesRes, settingsRes] = await Promise.all([
          fetch("/api/machines", { cache: "no-store" }),
          fetch("/api/settings", { cache: "no-store" }),
        ]);
        const machinesJson = await machinesRes.json().catch(() => ({}));
        const settingsJson = await settingsRes.json().catch(() => ({}));
        if (!alive) return;
        setMachines(machinesJson.machines ?? []);
        const shiftRows = settingsJson?.settings?.shiftSchedule?.shifts ?? [];
        setShifts(
          Array.isArray(shiftRows)
            ? shiftRows
                .map((row: unknown) => {
                  const data = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
                  const name = typeof data.name === "string" ? data.name : "";
                  const enabled = data.enabled !== false;
                  return { name, enabled };
                })
                .filter((row) => row.name)
            : []
        );
      } catch {
        if (!alive) return;
      } finally {
        if (alive) setLoading(false);
      }
    }

    loadFilters();
    return () => {
      alive = false;
    };
  }, [initialMachines, initialShifts]);

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();

    async function loadEvents() {
      const isDefault =
        range === "24h" &&
        !start &&
        !end &&
        !machineId &&
        !location &&
        !shift &&
        !eventType &&
        !severity &&
        !status &&
        !includeUpdates;
      if (skipInitialEventsRef.current) {
        skipInitialEventsRef.current = false;
        if (initialEvents.length && isDefault) return;
      }

      setLoadingEvents(true);
      setError(null);
      const params = new URLSearchParams();
      params.set("range", range);
      if (range === "custom") {
        if (start) params.set("start", start);
        if (end) params.set("end", end);
      }
      if (machineId) params.set("machineId", machineId);
      if (location) params.set("location", location);
      if (shift) params.set("shift", shift);
      if (eventType) params.set("eventType", eventType);
      if (severity) params.set("severity", severity);
      if (status) params.set("status", status);
      if (includeUpdates) params.set("includeUpdates", "1");
      params.set("limit", "250");

      try {
        const res = await fetch(`/api/alerts/inbox?${params.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        const json = await res.json().catch(() => ({}));
        if (!alive) return;
        if (!res.ok || !json?.ok) {
          setError(json?.error || t("alerts.inbox.error"));
          setEvents([]);
        } else {
          setEvents(json.events ?? []);
        }
      } catch {
        if (alive) {
          setError(t("alerts.inbox.error"));
          setEvents([]);
        }
      } finally {
        if (alive) setLoadingEvents(false);
      }
    }

    loadEvents();
    return () => {
      alive = false;
      controller.abort();
    };
  }, [
    range,
    start,
    end,
    machineId,
    location,
    shift,
    eventType,
    severity,
    status,
    includeUpdates,
    t,
    initialEvents.length,
  ]);

  const eventTypes = useMemo(() => {
    const seen = new Set<string>();
    for (const ev of events) {
      if (ev.eventType) seen.add(ev.eventType);
    }
    return Array.from(seen).sort();
  }, [events]);

  const severities = useMemo(() => {
    const seen = new Set<string>();
    for (const ev of events) {
      if (ev.severity) seen.add(ev.severity);
    }
    return Array.from(seen).sort();
  }, [events]);

  const statuses = useMemo(() => {
    const seen = new Set<string>();
    for (const ev of events) {
      if (ev.status) seen.add(ev.status);
    }
    return Array.from(seen).sort();
  }, [events]);

  const filteredEvents = useMemo(() => {
    if (!search.trim()) return events;
    const needle = search.trim().toLowerCase();
    return events.filter((ev) => {
      return (
        normalizeLabel(ev.title).toLowerCase().includes(needle) ||
        normalizeLabel(ev.description).toLowerCase().includes(needle) ||
        normalizeLabel(ev.machineName).toLowerCase().includes(needle) ||
        normalizeLabel(ev.location).toLowerCase().includes(needle) ||
        normalizeLabel(ev.eventType).toLowerCase().includes(needle)
      );
    });
  }, [events, search]);

  function formatEventTypeLabel(value: string) {
    const key = `alerts.event.${value}`;
    const label = t(key);
    return label === key ? value : label;
  }

  function formatStatusLabel(value?: string | null) {
    if (!value) return t("alerts.inbox.table.unknown");
    const key = `alerts.inbox.status.${value}`;
    const label = t(key);
    return label === key ? value : label;
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
      <div>
        <h1 className="text-2xl font-semibold text-white">{t("alerts.title")}</h1>
        <p className="mt-2 text-sm text-zinc-400">{t("alerts.subtitle")}</p>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm font-semibold text-white">{t("alerts.inbox.filters.title")}</div>
          {loading && <div className="text-xs text-zinc-500">{t("alerts.inbox.loadingFilters")}</div>}
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <label className="text-xs text-zinc-400">
            {t("alerts.inbox.filters.range")}
            <select
              className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
              value={range}
              onChange={(event) => setRange(event.target.value)}
            >
              {RANGE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {t(option.labelKey)}
                </option>
              ))}
            </select>
          </label>
          {range === "custom" && (
            <>
              <label className="text-xs text-zinc-400">
                {t("alerts.inbox.filters.start")}
                <input
                  type="date"
                  className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
                  value={start}
                  onChange={(event) => setStart(event.target.value)}
                />
              </label>
              <label className="text-xs text-zinc-400">
                {t("alerts.inbox.filters.end")}
                <input
                  type="date"
                  className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
                  value={end}
                  onChange={(event) => setEnd(event.target.value)}
                />
              </label>
            </>
          )}
          <label className="text-xs text-zinc-400">
            {t("alerts.inbox.filters.machine")}
            <select
              className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
              value={machineId}
              onChange={(event) => setMachineId(event.target.value)}
            >
              <option value="">{t("alerts.inbox.filters.allMachines")}</option>
              {machines.map((machine) => (
                <option key={machine.id} value={machine.id}>
                  {machine.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-zinc-400">
            {t("alerts.inbox.filters.site")}
            <select
              className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
              value={location}
              onChange={(event) => setLocation(event.target.value)}
            >
              <option value="">{t("alerts.inbox.filters.allSites")}</option>
              {locations.map((loc) => (
                <option key={loc} value={loc}>
                  {loc}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-zinc-400">
            {t("alerts.inbox.filters.shift")}
            <select
              className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
              value={shift}
              onChange={(event) => setShift(event.target.value)}
            >
              <option value="">{t("alerts.inbox.filters.allShifts")}</option>
              {shifts
                .filter((row) => row.enabled)
                .map((row) => (
                  <option key={row.name} value={row.name}>
                    {row.name}
                  </option>
                ))}
            </select>
          </label>
          <label className="text-xs text-zinc-400">
            {t("alerts.inbox.filters.type")}
            <select
              className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
              value={eventType}
              onChange={(event) => setEventType(event.target.value)}
            >
              <option value="">{t("alerts.inbox.filters.allTypes")}</option>
              {eventTypes.map((value) => (
                <option key={value} value={value}>
                  {formatEventTypeLabel(value)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-zinc-400">
            {t("alerts.inbox.filters.severity")}
            <select
              className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
              value={severity}
              onChange={(event) => setSeverity(event.target.value)}
            >
              <option value="">{t("alerts.inbox.filters.allSeverities")}</option>
              {severities.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-zinc-400">
            {t("alerts.inbox.filters.status")}
            <select
              className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
              value={status}
              onChange={(event) => setStatus(event.target.value)}
            >
              <option value="">{t("alerts.inbox.filters.allStatuses")}</option>
              {statuses.map((value) => (
                <option key={value} value={value}>
                  {formatStatusLabel(value)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-zinc-400">
            {t("alerts.inbox.filters.search")}
            <input
              className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t("alerts.inbox.filters.searchPlaceholder")}
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-zinc-400">
            <input
              type="checkbox"
              checked={includeUpdates}
              onChange={(event) => setIncludeUpdates(event.target.checked)}
              className="h-4 w-4 rounded border border-white/20 bg-black/20"
            />
            {t("alerts.inbox.filters.includeUpdates")}
          </label>
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm font-semibold text-white">{t("alerts.inbox.title")}</div>
          {loadingEvents && <div className="text-xs text-zinc-500">{t("alerts.inbox.loading")}</div>}
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200">
            {error}
          </div>
        )}

        {!loadingEvents && !filteredEvents.length && (
          <div className="text-sm text-zinc-400">{t("alerts.inbox.empty")}</div>
        )}

        {!!filteredEvents.length && (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm text-zinc-300">
              <thead>
                <tr className="text-xs uppercase text-zinc-500">
                  <th className="border-b border-white/10 px-3 py-2 text-left">{t("alerts.inbox.table.time")}</th>
                  <th className="border-b border-white/10 px-3 py-2 text-left">{t("alerts.inbox.table.machine")}</th>
                  <th className="border-b border-white/10 px-3 py-2 text-left">{t("alerts.inbox.table.site")}</th>
                  <th className="border-b border-white/10 px-3 py-2 text-left">{t("alerts.inbox.table.shift")}</th>
                  <th className="border-b border-white/10 px-3 py-2 text-left">{t("alerts.inbox.table.type")}</th>
                  <th className="border-b border-white/10 px-3 py-2 text-left">{t("alerts.inbox.table.severity")}</th>
                  <th className="border-b border-white/10 px-3 py-2 text-left">{t("alerts.inbox.table.status")}</th>
                  <th className="border-b border-white/10 px-3 py-2 text-left">{t("alerts.inbox.table.duration")}</th>
                  <th className="border-b border-white/10 px-3 py-2 text-left">{t("alerts.inbox.table.title")}</th>
                </tr>
              </thead>
              <tbody>
                {filteredEvents.map((ev) => (
                  <tr key={ev.id} className="border-b border-white/5">
                    <td className="px-3 py-3 text-xs text-zinc-400">
                      {new Date(ev.ts).toLocaleString(locale)}
                    </td>
                    <td className="px-3 py-3">{ev.machineName || t("alerts.inbox.table.unknown")}</td>
                    <td className="px-3 py-3">{ev.location || t("alerts.inbox.table.unknown")}</td>
                    <td className="px-3 py-3">{ev.shift || t("alerts.inbox.table.unknown")}</td>
                    <td className="px-3 py-3">{formatEventTypeLabel(ev.eventType)}</td>
                    <td className="px-3 py-3">{ev.severity || t("alerts.inbox.table.unknown")}</td>
                    <td className="px-3 py-3">{formatStatusLabel(ev.status)}</td>
                    <td className="px-3 py-3">{formatDuration(ev.durationSec, t)}</td>
                    <td className="px-3 py-3">
                      <div className="text-sm text-white">{ev.title}</div>
                      {ev.description && (
                        <div className="mt-1 text-xs text-zinc-400">{ev.description}</div>
                      )}
                      {(ev.workOrderId || ev.sku) && (
                        <div className="mt-1 text-[11px] text-zinc-500">
                          {ev.workOrderId ? `${t("alerts.inbox.meta.workOrder")}: ${ev.workOrderId}` : null}
                          {ev.workOrderId && ev.sku ? " • " : null}
                          {ev.sku ? `${t("alerts.inbox.meta.sku")}: ${ev.sku}` : null}
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
