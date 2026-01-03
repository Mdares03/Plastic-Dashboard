"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Shift = {
  name: string;
  start: string;
  end: string;
  enabled: boolean;
};

type SettingsPayload = {
  orgId?: string;
  version?: number;
  timezone?: string;
  shiftSchedule: {
    shifts: Shift[];
    shiftChangeCompensationMin: number;
    lunchBreakMin: number;
  };
  thresholds: {
    stoppageMultiplier: number;
    oeeAlertThresholdPct: number;
    performanceThresholdPct: number;
    qualitySpikeDeltaPct: number;
  };
  alerts: {
    oeeDropEnabled: boolean;
    performanceDegradationEnabled: boolean;
    qualitySpikeEnabled: boolean;
    predictiveOeeDeclineEnabled: boolean;
  };
  defaults: {
    moldTotal: number;
    moldActive: number;
  };
  updatedAt?: string;
  updatedBy?: string;
};

const DEFAULT_SHIFT: Shift = {
  name: "Shift 1",
  start: "06:00",
  end: "15:00",
  enabled: true,
};

const DEFAULT_SETTINGS: SettingsPayload = {
  orgId: "",
  version: 0,
  timezone: "UTC",
  shiftSchedule: {
    shifts: [DEFAULT_SHIFT],
    shiftChangeCompensationMin: 10,
    lunchBreakMin: 30,
  },
  thresholds: {
    stoppageMultiplier: 1.5,
    oeeAlertThresholdPct: 90,
    performanceThresholdPct: 85,
    qualitySpikeDeltaPct: 5,
  },
  alerts: {
    oeeDropEnabled: true,
    performanceDegradationEnabled: true,
    qualitySpikeEnabled: true,
    predictiveOeeDeclineEnabled: true,
  },
  defaults: {
    moldTotal: 1,
    moldActive: 1,
  },
  updatedAt: "",
  updatedBy: "",
};

async function readResponse(response: Response) {
  const text = await response.text();
  if (!text) {
    return { data: null as any, text: "" };
  }
  try {
    return { data: JSON.parse(text), text };
  } catch {
    return { data: null as any, text };
  }
}

function normalizeShift(raw: any, index: number): Shift {
  const name = String(raw?.name || `Shift ${index + 1}`);
  const start = String(raw?.start || raw?.startTime || DEFAULT_SHIFT.start);
  const end = String(raw?.end || raw?.endTime || DEFAULT_SHIFT.end);
  const enabled = raw?.enabled !== false;
  return { name, start, end, enabled };
}

function normalizeSettings(raw: any): SettingsPayload {
  if (!raw || typeof raw !== "object") return { ...DEFAULT_SETTINGS };

  const shiftSchedule = raw.shiftSchedule || {};
  const shiftsRaw = Array.isArray(shiftSchedule.shifts) ? shiftSchedule.shifts : [];
  const shifts = shiftsRaw.length
    ? shiftsRaw.map((s: any, idx: number) => normalizeShift(s, idx))
    : [DEFAULT_SHIFT];

  return {
    orgId: String(raw.orgId || ""),
    version: Number(raw.version || 0),
    timezone: String(raw.timezone || DEFAULT_SETTINGS.timezone),
    shiftSchedule: {
      shifts,
      shiftChangeCompensationMin: Number(
        shiftSchedule.shiftChangeCompensationMin ?? DEFAULT_SETTINGS.shiftSchedule.shiftChangeCompensationMin
      ),
      lunchBreakMin: Number(shiftSchedule.lunchBreakMin ?? DEFAULT_SETTINGS.shiftSchedule.lunchBreakMin),
    },
    thresholds: {
      stoppageMultiplier: Number(
        raw.thresholds?.stoppageMultiplier ?? DEFAULT_SETTINGS.thresholds.stoppageMultiplier
      ),
      oeeAlertThresholdPct: Number(
        raw.thresholds?.oeeAlertThresholdPct ?? DEFAULT_SETTINGS.thresholds.oeeAlertThresholdPct
      ),
      performanceThresholdPct: Number(
        raw.thresholds?.performanceThresholdPct ?? DEFAULT_SETTINGS.thresholds.performanceThresholdPct
      ),
      qualitySpikeDeltaPct: Number(
        raw.thresholds?.qualitySpikeDeltaPct ?? DEFAULT_SETTINGS.thresholds.qualitySpikeDeltaPct
      ),
    },
    alerts: {
      oeeDropEnabled: raw.alerts?.oeeDropEnabled ?? DEFAULT_SETTINGS.alerts.oeeDropEnabled,
      performanceDegradationEnabled:
        raw.alerts?.performanceDegradationEnabled ?? DEFAULT_SETTINGS.alerts.performanceDegradationEnabled,
      qualitySpikeEnabled: raw.alerts?.qualitySpikeEnabled ?? DEFAULT_SETTINGS.alerts.qualitySpikeEnabled,
      predictiveOeeDeclineEnabled:
        raw.alerts?.predictiveOeeDeclineEnabled ?? DEFAULT_SETTINGS.alerts.predictiveOeeDeclineEnabled,
    },
    defaults: {
      moldTotal: Number(raw.defaults?.moldTotal ?? DEFAULT_SETTINGS.defaults.moldTotal),
      moldActive: Number(raw.defaults?.moldActive ?? DEFAULT_SETTINGS.defaults.moldActive),
    },
    updatedAt: raw.updatedAt ? String(raw.updatedAt) : "",
    updatedBy: raw.updatedBy ? String(raw.updatedBy) : "",
  };
}

function Toggle({
  label,
  helper,
  enabled,
  onChange,
}: {
  label: string;
  helper: string;
  enabled: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!enabled)}
      className="flex w-full items-center justify-between gap-4 rounded-xl border border-white/10 bg-black/20 px-4 py-3 text-left hover:bg-white/5"
    >
      <div>
        <div className="text-sm font-semibold text-white">{label}</div>
        <div className="text-xs text-zinc-400">{helper}</div>
      </div>
      <span
        className={`h-6 w-12 rounded-full border border-white/10 p-0.5 transition ${
          enabled ? "bg-emerald-500/20" : "bg-white/5"
        }`}
      >
        <span
          className={`block h-5 w-5 rounded-full transition ${
            enabled ? "translate-x-6 bg-emerald-400" : "bg-zinc-500"
          }`}
        />
      </span>
    </button>
  );
}

export default function SettingsPage() {
  const [draft, setDraft] = useState<SettingsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<string | null>(null);

  const loadSettings = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch("/api/settings", { cache: "no-store" });
      const { data, text } = await readResponse(response);
      if (!response.ok || !data?.ok) {
        const message =
          data?.error || data?.message || text || `Failed to load settings (${response.status})`;
        throw new Error(message);
      }
      const next = normalizeSettings(data.settings);
      setDraft(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load settings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  const updateShift = useCallback((index: number, patch: Partial<Shift>) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const shifts = prev.shiftSchedule.shifts.map((shift, idx) =>
        idx === index ? { ...shift, ...patch } : shift
      );
      return {
        ...prev,
        shiftSchedule: {
          ...prev.shiftSchedule,
          shifts,
        },
      };
    });
  }, []);

  const addShift = useCallback(() => {
    setDraft((prev) => {
      if (!prev) return prev;
      if (prev.shiftSchedule.shifts.length >= 3) return prev;
      const nextIndex = prev.shiftSchedule.shifts.length + 1;
      const newShift: Shift = {
        name: `Shift ${nextIndex}`,
        start: DEFAULT_SHIFT.start,
        end: DEFAULT_SHIFT.end,
        enabled: true,
      };
      return {
        ...prev,
        shiftSchedule: {
          ...prev.shiftSchedule,
          shifts: [...prev.shiftSchedule.shifts, newShift],
        },
      };
    });
  }, []);

  const removeShift = useCallback((index: number) => {
    setDraft((prev) => {
      if (!prev) return prev;
      if (prev.shiftSchedule.shifts.length <= 1) return prev;
      const shifts = prev.shiftSchedule.shifts.filter((_, idx) => idx !== index);
      return {
        ...prev,
        shiftSchedule: {
          ...prev.shiftSchedule,
          shifts,
        },
      };
    });
  }, []);

  const updateShiftField = useCallback((key: "shiftChangeCompensationMin" | "lunchBreakMin", value: number) => {
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        shiftSchedule: {
          ...prev.shiftSchedule,
          [key]: value,
        },
      };
    });
  }, []);

  const updateThreshold = useCallback(
    (
      key:
        | "stoppageMultiplier"
        | "oeeAlertThresholdPct"
        | "performanceThresholdPct"
        | "qualitySpikeDeltaPct",
      value: number
    ) => {
      setDraft((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          thresholds: {
            ...prev.thresholds,
            [key]: value,
          },
        };
      });
    },
    []
  );

  const updateDefaults = useCallback((key: "moldTotal" | "moldActive", value: number) => {
    setDraft((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        defaults: {
          ...prev.defaults,
          [key]: value,
        },
      };
    });
  }, []);

  const updateAlerts = useCallback(
    (
      key:
        | "oeeDropEnabled"
        | "performanceDegradationEnabled"
        | "qualitySpikeEnabled"
        | "predictiveOeeDeclineEnabled",
      value: boolean
    ) => {
      setDraft((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          alerts: {
            ...prev.alerts,
            [key]: value,
          },
        };
      });
    },
    []
  );

  const saveSettings = useCallback(async () => {
    if (!draft) return;
    setSaving(true);
    setSaveStatus(null);
    setError(null);
    try {
      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "control_tower",
          version: draft.version,
          timezone: draft.timezone,
          shiftSchedule: draft.shiftSchedule,
          thresholds: draft.thresholds,
          alerts: draft.alerts,
          defaults: draft.defaults,
        }),
      });
      const { data, text } = await readResponse(response);
      if (!response.ok || !data?.ok) {
        if (response.status === 409) {
          throw new Error("Settings changed elsewhere. Refresh and try again.");
        }
        const message =
          data?.error || data?.message || text || `Failed to save settings (${response.status})`;
        throw new Error(message);
      }
      const next = normalizeSettings(data.settings);
      setDraft(next);
      setSaveStatus("Saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  }, [draft]);

  const statusLabel = useMemo(() => {
    if (loading) return "Loading settings...";
    if (saving) return "Saving...";
    return saveStatus;
  }, [loading, saving, saveStatus]);

  if (loading && !draft) {
    return (
      <div className="p-6">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-sm text-zinc-300">
          Loading settings...
        </div>
      </div>
    );
  }

  if (!draft) {
    return (
      <div className="p-6">
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-6 text-sm text-red-200">
          {error || "Settings are unavailable."}
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-white">Settings</h1>
          <p className="text-sm text-zinc-400">Live configuration for shifts, alerts, and defaults.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={loadSettings}
            className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white hover:bg-white/10"
          >
            Refresh
          </button>
          <button
            onClick={saveSettings}
            disabled={saving}
            className="rounded-xl border border-emerald-400/40 bg-emerald-500/20 px-4 py-2 text-sm text-emerald-100 hover:bg-emerald-500/30 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Save Changes
          </button>
        </div>
      </div>

      {(error || statusLabel) && (
        <div className="mb-6 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-zinc-300">
          {error ? error : statusLabel}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5 xl:col-span-1">
          <div className="text-sm font-semibold text-white">Organization</div>
          <div className="mt-4 space-y-3">
            <div className="rounded-xl border border-white/10 bg-black/20 p-3">
              <div className="text-xs text-zinc-400">Plant Name</div>
              <div className="mt-1 text-sm text-zinc-300">MIS Plant</div>
            </div>
            <label className="block rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-zinc-400">
              Time Zone
              <input
                value={draft.timezone || ""}
                onChange={(event) =>
                  setDraft((prev) =>
                    prev
                      ? {
                          ...prev,
                          timezone: event.target.value,
                        }
                      : prev
                  )
                }
                className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
              />
            </label>
            <div className="text-xs text-zinc-500">
              Updated: {draft.updatedAt ? new Date(draft.updatedAt).toLocaleString() : "-"}
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-5 xl:col-span-2">
          <div className="mb-3 flex items-center justify-between gap-4">
            <div className="text-sm font-semibold text-white">Alert Thresholds</div>
            <div className="text-xs text-zinc-400">Applies to all machines</div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-zinc-400">
              OEE Alert (%)
              <input
                type="number"
                min={50}
                max={100}
                value={draft.thresholds.oeeAlertThresholdPct}
                onChange={(event) =>
                  updateThreshold("oeeAlertThresholdPct", Number(event.target.value))
                }
                className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
              />
            </label>
            <label className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-zinc-400">
              Stoppage Multiplier
              <input
                type="number"
                min={1.1}
                max={5}
                step={0.1}
                value={draft.thresholds.stoppageMultiplier}
                onChange={(event) =>
                  updateThreshold("stoppageMultiplier", Number(event.target.value))
                }
                className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
              />
            </label>
            <label className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-zinc-400">
              Performance Alert (%)
              <input
                type="number"
                min={50}
                max={100}
                value={draft.thresholds.performanceThresholdPct}
                onChange={(event) =>
                  updateThreshold("performanceThresholdPct", Number(event.target.value))
                }
                className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
              />
            </label>
            <label className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-zinc-400">
              Quality Spike Delta (%)
              <input
                type="number"
                min={0}
                max={100}
                value={draft.thresholds.qualitySpikeDeltaPct}
                onChange={(event) =>
                  updateThreshold("qualitySpikeDeltaPct", Number(event.target.value))
                }
                className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
              />
            </label>
          </div>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5 xl:col-span-2">
          <div className="mb-3 flex items-center justify-between gap-4">
            <div className="text-sm font-semibold text-white">Shift Schedule</div>
            <div className="text-xs text-zinc-400">Max 3 shifts, HH:mm</div>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {draft.shiftSchedule.shifts.map((shift, index) => (
              <div key={`${shift.name}-${index}`} className="rounded-xl border border-white/10 bg-black/20 p-3">
                <div className="flex items-center justify-between">
                  <input
                    value={shift.name}
                    onChange={(event) => updateShift(index, { name: event.target.value })}
                    className="w-full rounded-md border border-white/10 bg-black/30 px-2 py-1 text-sm text-white"
                  />
                  <button
                    type="button"
                    onClick={() => removeShift(index)}
                    disabled={draft.shiftSchedule.shifts.length <= 1}
                    className="ml-3 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-white disabled:opacity-40"
                  >
                    Remove
                  </button>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <input
                    type="time"
                    value={shift.start}
                    onChange={(event) => updateShift(index, { start: event.target.value })}
                    className="w-full rounded-md border border-white/10 bg-black/30 px-2 py-1 text-sm text-white"
                  />
                  <span className="text-xs text-zinc-400">to</span>
                  <input
                    type="time"
                    value={shift.end}
                    onChange={(event) => updateShift(index, { end: event.target.value })}
                    className="w-full rounded-md border border-white/10 bg-black/30 px-2 py-1 text-sm text-white"
                  />
                </div>
                <div className="mt-3 flex items-center gap-2 text-xs text-zinc-400">
                  <input
                    type="checkbox"
                    checked={shift.enabled}
                    onChange={(event) => updateShift(index, { enabled: event.target.checked })}
                    className="h-4 w-4 rounded border border-white/20 bg-black/20"
                  />
                  Enabled
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={addShift}
              disabled={draft.shiftSchedule.shifts.length >= 3}
              className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white disabled:opacity-40"
            >
              Add Shift
            </button>
            <div className="flex flex-1 flex-wrap gap-3">
              <label className="flex-1 rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-zinc-400">
                Shift Change Compensation (min)
                <input
                  type="number"
                  min={0}
                  max={480}
                  value={draft.shiftSchedule.shiftChangeCompensationMin}
                  onChange={(event) =>
                    updateShiftField("shiftChangeCompensationMin", Number(event.target.value))
                  }
                  className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
                />
              </label>
              <label className="flex-1 rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-zinc-400">
                Lunch Break (min)
                <input
                  type="number"
                  min={0}
                  max={480}
                  value={draft.shiftSchedule.lunchBreakMin}
                  onChange={(event) => updateShiftField("lunchBreakMin", Number(event.target.value))}
                  className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
                />
              </label>
            </div>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <div className="text-sm font-semibold text-white">Alerts</div>
          <div className="mt-4 space-y-3">
            <Toggle
              label="OEE Drop"
              helper="Notify when OEE falls below threshold"
              enabled={draft.alerts.oeeDropEnabled}
              onChange={(next) => updateAlerts("oeeDropEnabled", next)}
            />
            <Toggle
              label="Performance Degradation"
              helper="Flag prolonged slow cycles"
              enabled={draft.alerts.performanceDegradationEnabled}
              onChange={(next) => updateAlerts("performanceDegradationEnabled", next)}
            />
            <Toggle
              label="Quality Spike"
              helper="Alert on scrap spikes"
              enabled={draft.alerts.qualitySpikeEnabled}
              onChange={(next) => updateAlerts("qualitySpikeEnabled", next)}
            />
            <Toggle
              label="Predictive OEE Decline"
              helper="Warn before OEE drops"
              enabled={draft.alerts.predictiveOeeDeclineEnabled}
              onChange={(next) => updateAlerts("predictiveOeeDeclineEnabled", next)}
            />
          </div>
        </div>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <div className="mb-3 text-sm font-semibold text-white">Mold Defaults</div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-zinc-400">
              Mold Total
              <input
                type="number"
                min={0}
                value={draft.defaults.moldTotal}
                onChange={(event) => updateDefaults("moldTotal", Number(event.target.value))}
                className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
              />
            </label>
            <label className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-zinc-400">
              Mold Active
              <input
                type="number"
                min={0}
                value={draft.defaults.moldActive}
                onChange={(event) => updateDefaults("moldActive", Number(event.target.value))}
                className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
              />
            </label>
          </div>
        </div>

        <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
          <div className="mb-3 text-sm font-semibold text-white">Integrations</div>
          <div className="space-y-3 text-sm text-zinc-300">
            <div className="rounded-xl border border-white/10 bg-black/20 p-3">
              <div className="text-xs text-zinc-400">Webhook URL</div>
              <div className="mt-1 text-sm text-white">https://hooks.example.com/iiot</div>
            </div>
            <div className="rounded-xl border border-white/10 bg-black/20 p-3">
              <div className="text-xs text-zinc-400">ERP Sync</div>
              <div className="mt-1 text-sm text-zinc-300">Not configured</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
