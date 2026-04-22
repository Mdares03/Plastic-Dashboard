"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertsConfig } from "@/components/settings/AlertsConfig";
import { FinancialCostConfig } from "@/components/settings/FinancialCostConfig";
import { useI18n } from "@/lib/i18n/useI18n";
import { SHIFT_OVERRIDE_DAYS, type ShiftOverrideDay } from "@/lib/settings";
import { useScreenlessMode } from "@/lib/ui/screenlessMode";


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

  modules: {
    screenlessMode: boolean;
  };

  shiftSchedule: {
    shifts: Shift[];
    overrides?: Partial<Record<ShiftOverrideDay, Shift[]>>;
    shiftChangeCompensationMin: number;
    lunchBreakMin: number;
  };
  thresholds: {
    stoppageMultiplier: number;
    macroStoppageMultiplier: number;
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


type OrgInfo = {
  id: string;
  name: string;
  slug: string;
};

type MemberRow = {
  id: string;
  membershipId: string;
  name?: string | null;
  email: string;
  role: string;
  isActive: boolean;
  joinedAt: string;
};

type InviteRow = {
  id: string;
  email: string;
  role: string;
  token: string;
  createdAt: string;
  expiresAt: string;
};

const DEFAULT_SHIFT: Omit<Shift, "name"> = {
  start: "06:00",
  end: "15:00",
  enabled: true,
};

const DEFAULT_SETTINGS: SettingsPayload = {
  orgId: "",
  version: 0,
  timezone: "UTC",
  modules: { screenlessMode: false },
  shiftSchedule: {
    shifts: [],
    overrides: {},
    shiftChangeCompensationMin: 10,
    lunchBreakMin: 30,
  },
  thresholds: {
    stoppageMultiplier: 1.5,
    oeeAlertThresholdPct: 90,
    macroStoppageMultiplier: 5,
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

const SETTINGS_TABS = [
  { id: "general", labelKey: "settings.tabs.general" },
  { id: "modules", labelKey: "settings.tabs.modules" },
  { id: "shifts", labelKey: "settings.tabs.shifts" },
  { id: "thresholds", labelKey: "settings.tabs.thresholds" },
  { id: "alerts", labelKey: "settings.tabs.alerts" },
  { id: "financial", labelKey: "settings.tabs.financial" },
  { id: "team", labelKey: "settings.tabs.team" },
] as const;

type ReadResponse<T> = { data: T | null; text: string };
type ApiEnvelope = { ok: boolean; error?: string; message?: string };

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function unwrapApiResponse(data: unknown): { ok: boolean; error: string | null; record: Record<string, unknown> | null } {
  const record = asRecord(data);
  const ok = typeof record?.ok === "boolean" ? record.ok : false;
  const error =
    typeof record?.error === "string"
      ? record.error
      : typeof record?.message === "string"
        ? record.message
        : null;
  return { ok, error, record };
}

function isOrgInfo(value: unknown): value is OrgInfo {
  const record = asRecord(value);
  return (
    !!record &&
    typeof record.id === "string" &&
    typeof record.name === "string" &&
    typeof record.slug === "string"
  );
}

function isMemberRow(value: unknown): value is MemberRow {
  const record = asRecord(value);
  return (
    !!record &&
    typeof record.id === "string" &&
    typeof record.membershipId === "string" &&
    typeof record.email === "string" &&
    typeof record.role === "string" &&
    typeof record.isActive === "boolean" &&
    typeof record.joinedAt === "string"
  );
}

function isInviteRow(value: unknown): value is InviteRow {
  const record = asRecord(value);
  return (
    !!record &&
    typeof record.id === "string" &&
    typeof record.email === "string" &&
    typeof record.role === "string" &&
    typeof record.token === "string" &&
    typeof record.createdAt === "string" &&
    typeof record.expiresAt === "string"
  );
}

async function readResponse<T>(response: Response): Promise<ReadResponse<T>> {
  const text = await response.text();
  if (!text) {
    return { data: null, text: "" };
  }
  try {
    return { data: JSON.parse(text) as T, text };
  } catch {
    return { data: null, text };
  }
}

function normalizeShift(raw: unknown, fallbackName: string): Shift {
  const record = asRecord(raw);
  const name = String(record?.name ?? fallbackName);
  const start = String(record?.start ?? record?.startTime ?? DEFAULT_SHIFT.start);
  const end = String(record?.end ?? record?.endTime ?? DEFAULT_SHIFT.end);
  const enabled = record?.enabled !== false;
  return { name, start, end, enabled };
}

function normalizeShiftOverrides(
  raw: unknown,
  fallbackName: (index: number) => string
): Partial<Record<ShiftOverrideDay, Shift[]>> {
  const record = asRecord(raw);
  if (!record) return {};
  const out: Partial<Record<ShiftOverrideDay, Shift[]>> = {};
  for (const day of SHIFT_OVERRIDE_DAYS) {
    const shiftsRaw = Array.isArray(record[day]) ? (record[day] as unknown[]) : null;
    if (!shiftsRaw) continue;
    out[day] = shiftsRaw.map((shift, idx) => normalizeShift(shift, fallbackName(idx + 1)));
  }
  return out;
}

function normalizeSettings(raw: unknown, fallbackName: (index: number) => string): SettingsPayload {
  const record = asRecord(raw);
  const modules = asRecord(record?.modules) ?? {};
  if (!record) {
    return {
      ...DEFAULT_SETTINGS,
      shiftSchedule: {
        ...DEFAULT_SETTINGS.shiftSchedule,
        shifts: [{ name: fallbackName(1), ...DEFAULT_SHIFT }],
      },
    };
  }

  const shiftSchedule = asRecord(record.shiftSchedule) ?? {};
  const shiftsRaw = Array.isArray(shiftSchedule.shifts) ? shiftSchedule.shifts : [];
  const shifts = shiftsRaw.length
    ? shiftsRaw.map((s, idx) => normalizeShift(s, fallbackName(idx + 1)))
    : [{ name: fallbackName(1), ...DEFAULT_SHIFT }];
  const overrides = normalizeShiftOverrides(shiftSchedule.overrides, fallbackName);
  const thresholds = asRecord(record.thresholds) ?? {};
  const alerts = asRecord(record.alerts) ?? {};
  const defaults = asRecord(record.defaults) ?? {};

  return {
    orgId: String(record.orgId ?? ""),
    version: Number(record.version ?? 0),
    timezone: String(record.timezone ?? DEFAULT_SETTINGS.timezone),
    shiftSchedule: {
      shifts,
      overrides,
      shiftChangeCompensationMin: Number(
        shiftSchedule.shiftChangeCompensationMin ?? DEFAULT_SETTINGS.shiftSchedule.shiftChangeCompensationMin
      ),
      lunchBreakMin: Number(shiftSchedule.lunchBreakMin ?? DEFAULT_SETTINGS.shiftSchedule.lunchBreakMin),
    },
    thresholds: {
      stoppageMultiplier: Number(
        thresholds.stoppageMultiplier ?? DEFAULT_SETTINGS.thresholds.stoppageMultiplier
      ),
      macroStoppageMultiplier: Number(
        thresholds.macroStoppageMultiplier ?? DEFAULT_SETTINGS.thresholds.macroStoppageMultiplier
      ),
      oeeAlertThresholdPct: Number(
        thresholds.oeeAlertThresholdPct ?? DEFAULT_SETTINGS.thresholds.oeeAlertThresholdPct
      ),
      performanceThresholdPct: Number(
        thresholds.performanceThresholdPct ?? DEFAULT_SETTINGS.thresholds.performanceThresholdPct
      ),
      qualitySpikeDeltaPct: Number(
        thresholds.qualitySpikeDeltaPct ?? DEFAULT_SETTINGS.thresholds.qualitySpikeDeltaPct
      ),
    },
    alerts: {
      oeeDropEnabled: (alerts.oeeDropEnabled as boolean | undefined) ?? DEFAULT_SETTINGS.alerts.oeeDropEnabled,
      performanceDegradationEnabled:
        (alerts.performanceDegradationEnabled as boolean | undefined) ??
        DEFAULT_SETTINGS.alerts.performanceDegradationEnabled,
      qualitySpikeEnabled:
        (alerts.qualitySpikeEnabled as boolean | undefined) ?? DEFAULT_SETTINGS.alerts.qualitySpikeEnabled,
      predictiveOeeDeclineEnabled:
        (alerts.predictiveOeeDeclineEnabled as boolean | undefined) ??
        DEFAULT_SETTINGS.alerts.predictiveOeeDeclineEnabled,
    },
    defaults: {
      moldTotal: Number(defaults.moldTotal ?? DEFAULT_SETTINGS.defaults.moldTotal),
      moldActive: Number(defaults.moldActive ?? DEFAULT_SETTINGS.defaults.moldActive),
    },
    modules: {
  screenlessMode: (modules.screenlessMode as boolean | undefined) ?? false,
    },
    updatedAt: record.updatedAt ? String(record.updatedAt) : "",
    updatedBy: record.updatedBy ? String(record.updatedBy) : "",
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
  const { t, locale } = useI18n();
  const { setScreenlessMode } = useScreenlessMode();
  const [draft, setDraft] = useState<SettingsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<"saved" | null>(null);
  const [orgInfo, setOrgInfo] = useState<OrgInfo | null>(null);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [teamLoading, setTeamLoading] = useState(true);
  const [teamError, setTeamError] = useState<string | null>(null);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("MEMBER");
  const [inviteStatus, setInviteStatus] = useState<string | null>(null);
  const [inviteSubmitting, setInviteSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState<(typeof SETTINGS_TABS)[number]["id"]>("general");
  const hasMountedRef = useRef(false);
  const defaultShiftName = useCallback(
    (index: number) => t("settings.shift.defaultName", { index }),
    [t]
  );
  const shiftOverrideDays = useMemo(
    () =>
      SHIFT_OVERRIDE_DAYS.map((day) => ({
        key: day,
        label: t(`settings.shiftOverrides.${day}`),
      })),
    [t]
  );

  const loadSettings = useCallback(async (forceRefresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const url = forceRefresh ? "/api/settings?refresh=1" : "/api/settings";
      const response = await fetch(url, { cache: forceRefresh ? "no-store" : "default" });
      const { data, text } = await readResponse(response);
      const api = unwrapApiResponse(data);
      if (!response.ok || !api.ok) {
        const message = api.error || text || t("settings.failedLoad");
        throw new Error(message);
      }
      const next = normalizeSettings(api.record?.settings, defaultShiftName);
      setDraft(next);
      setScreenlessMode(next.modules.screenlessMode);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("settings.failedLoad"));
    } finally {
      setLoading(false);
    }
  }, [defaultShiftName, t, setScreenlessMode]);

  const buildInviteUrl = useCallback((token: string) => {
    if (typeof window === "undefined") return `/invite/${token}`;
    return `${window.location.origin}/invite/${token}`;
  }, []);

  const loadTeam = useCallback(async () => {
    setTeamLoading(true);
    setTeamError(null);
    try {
      const response = await fetch("/api/org/members", { cache: "no-store" });
      const { data, text } = await readResponse(response);
      const api = unwrapApiResponse(data);
      if (!response.ok || !api.ok) {
        const message = api.error || text || t("settings.failedTeam");
        throw new Error(message);
      }
      setOrgInfo(isOrgInfo(api.record?.org) ? api.record?.org : null);
      const membersRaw = Array.isArray(api.record?.members) ? api.record?.members : [];
      const invitesRaw = Array.isArray(api.record?.invites) ? api.record?.invites : [];
      setMembers(membersRaw.filter(isMemberRow));
      setInvites(invitesRaw.filter(isInviteRow));
    } catch (err) {
      setTeamError(err instanceof Error ? err.message : t("settings.failedTeam"));
    } finally {
      setTeamLoading(false);
    }
  }, [t]);

  // Only run once on mount to prevent infinite loops from dependency changes
  useEffect(() => {
    if (hasMountedRef.current) return;
    hasMountedRef.current = true;
    loadSettings();
    loadTeam();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        name: defaultShiftName(nextIndex),
        ...DEFAULT_SHIFT,
      };
      return {
        ...prev,
        shiftSchedule: {
          ...prev.shiftSchedule,
          shifts: [...prev.shiftSchedule.shifts, newShift],
        },
      };
    });
  }, [defaultShiftName]);

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

  const toggleShiftOverride = useCallback((day: ShiftOverrideDay) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const overrides = { ...(prev.shiftSchedule.overrides ?? {}) };
      if (overrides[day]) {
        delete overrides[day];
      } else {
        overrides[day] = prev.shiftSchedule.shifts.map((shift) => ({ ...shift }));
      }
      return {
        ...prev,
        shiftSchedule: {
          ...prev.shiftSchedule,
          overrides,
        },
      };
    });
  }, []);

  const updateShiftOverride = useCallback((day: ShiftOverrideDay, index: number, patch: Partial<Shift>) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const current = prev.shiftSchedule.overrides?.[day];
      if (!current) return prev;
      const overrides = { ...(prev.shiftSchedule.overrides ?? {}) };
      overrides[day] = current.map((shift, idx) => (idx === index ? { ...shift, ...patch } : shift));
      return {
        ...prev,
        shiftSchedule: {
          ...prev.shiftSchedule,
          overrides,
        },
      };
    });
  }, []);

  const addShiftOverride = useCallback(
    (day: ShiftOverrideDay) => {
      setDraft((prev) => {
        if (!prev) return prev;
        const overrides = { ...(prev.shiftSchedule.overrides ?? {}) };
        const current = overrides[day] ? [...overrides[day]!] : [];
        if (current.length >= 3) return prev;
        const nextIndex = current.length + 1;
        current.push({ name: defaultShiftName(nextIndex), ...DEFAULT_SHIFT });
        overrides[day] = current;
        return {
          ...prev,
          shiftSchedule: {
            ...prev.shiftSchedule,
            overrides,
          },
        };
      });
    },
    [defaultShiftName]
  );

  const removeShiftOverride = useCallback((day: ShiftOverrideDay, index: number) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const current = prev.shiftSchedule.overrides?.[day];
      if (!current) return prev;
      const overrides = { ...(prev.shiftSchedule.overrides ?? {}) };
      overrides[day] = current.filter((_, idx) => idx !== index);
      return {
        ...prev,
        shiftSchedule: {
          ...prev.shiftSchedule,
          overrides,
        },
      };
    });
  }, []);

  const clearShiftOverride = useCallback((day: ShiftOverrideDay) => {
    setDraft((prev) => {
      if (!prev) return prev;
      const overrides = { ...(prev.shiftSchedule.overrides ?? {}) };
      overrides[day] = [];
      return {
        ...prev,
        shiftSchedule: {
          ...prev.shiftSchedule,
          overrides,
        },
      };
    });
  }, []);

  const updateThreshold = useCallback(
    (
      key:
        | "stoppageMultiplier"
        | "macroStoppageMultiplier"
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

  const copyInviteLink = useCallback(
    async (token: string) => {
      const url = buildInviteUrl(token);
      try {
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(url);
          setInviteStatus(t("settings.inviteStatus.copied"));
        } else {
          setInviteStatus(url);
        }
      } catch {
        setInviteStatus(url);
      }
    },
    [buildInviteUrl, t]
  );

  const revokeInvite = useCallback(async (inviteId: string) => {
    setInviteStatus(null);
    try {
      const response = await fetch(`/api/org/invites/${inviteId}`, { method: "DELETE" });
      const { data, text } = await readResponse(response);
      const api = unwrapApiResponse(data);
      if (!response.ok || !api.ok) {
        const message = api.error || text || t("settings.inviteStatus.failed");
        throw new Error(message);
      }
      setInvites((prev) => prev.filter((invite) => invite.id !== inviteId));
    } catch (err) {
      setInviteStatus(err instanceof Error ? err.message : t("settings.inviteStatus.failed"));
    }
  }, [t]);

  const createInvite = useCallback(async () => {
    if (!inviteEmail.trim()) {
      setInviteStatus(t("settings.inviteStatus.emailRequired"));
      return;
    }
    setInviteSubmitting(true);
    setInviteStatus(null);
    try {
      const response = await fetch("/api/org/members", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      });
      const { data, text } = await readResponse(response);
      const api = unwrapApiResponse(data);
      if (!response.ok || !api.ok) {
        const message = api.error || text || t("settings.inviteStatus.createFailed");
        throw new Error(message);
      }
      const nextInvite = api.record?.invite;
      if (isInviteRow(nextInvite)) {
        setInvites((prev) => [nextInvite, ...prev.filter((invite) => invite.id !== nextInvite.id)]);
        const inviteUrl = buildInviteUrl(nextInvite.token);
        if (api.record?.emailSent === false) {
          setInviteStatus(t("settings.inviteStatus.emailFailed", { url: inviteUrl }));
        } else {
          setInviteStatus(t("settings.inviteStatus.sent"));
        }
      }
      setInviteEmail("");
      await loadTeam();
    } catch (err) {
      setInviteStatus(err instanceof Error ? err.message : t("settings.inviteStatus.createFailed"));
    } finally {
      setInviteSubmitting(false);
    }
  }, [buildInviteUrl, inviteEmail, inviteRole, loadTeam, t]);

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
          modules: draft.modules,
          shiftSchedule: draft.shiftSchedule,
          thresholds: draft.thresholds,
          alerts: draft.alerts,
          defaults: draft.defaults,
        }),
      });
      const { data, text } = await readResponse(response);
      const api = unwrapApiResponse(data);
      if (!response.ok || !api.ok) {
        if (response.status === 409) {
          throw new Error(t("settings.conflict"));
        }
        const message = api.error || text || t("settings.failedSave");
        throw new Error(message);
      }
      const next = normalizeSettings(api.record?.settings, defaultShiftName);
      setDraft(next);
      setScreenlessMode(next.modules.screenlessMode);
      setSaveStatus("saved");
    } catch (err) {
      setError(err instanceof Error ? err.message : t("settings.failedSave"));
    } finally {
      setSaving(false);
    }
  }, [defaultShiftName, draft, t]);

  const statusLabel = useMemo(() => {
    if (loading) return t("settings.loading");
    if (saving) return t("settings.saving");
    if (saveStatus === "saved") return t("settings.saved");
    return null;
  }, [loading, saving, saveStatus, t]);

  const formatRole = useCallback(
    (role?: string | null) => {
      if (!role) return "";
      const key = `settings.role.${role.toLowerCase()}`;
      const label = t(key);
      return label === key ? role : label;
    },
    [t]
  );

  if (loading && !draft) {
    return (
      <div className="p-4 sm:p-6">
        <div className="rounded-2xl border border-white/10 bg-white/5 p-6 text-sm text-zinc-300">
          {t("settings.loading")}
        </div>
      </div>
    );
  }

  if (!draft) {
    return (
    <div className="p-4 sm:p-6">
      <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-6 text-sm text-red-200">
        {error || t("settings.unavailable")}
      </div>
    </div>
    );
  }

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">{t("settings.title")}</h1>
          <p className="text-sm text-zinc-400">{t("settings.subtitle")}</p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
          <button
            onClick={() => loadSettings(true)}
            className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-center text-sm text-white hover:bg-white/10 sm:w-auto"
          >
            {t("settings.refresh")}
          </button>
          <button
            onClick={saveSettings}
            disabled={saving}
            className="w-full rounded-xl border border-emerald-400/40 bg-emerald-500/20 px-4 py-2 text-center text-sm text-emerald-100 hover:bg-emerald-500/30 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
          >
            {t("settings.save")}
          </button>
        </div>
      </div>

      {(error || statusLabel) && (
        <div className="mb-6 rounded-2xl border border-white/10 bg-white/5 p-4 text-sm text-zinc-300">
          {error ? error : statusLabel}
        </div>
      )}

      <div className="mb-6 flex flex-wrap gap-2 rounded-2xl border border-white/10 bg-white/5 p-2">
        {SETTINGS_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={
              tab.id === activeTab
                ? "rounded-xl bg-emerald-500/20 px-4 py-2 text-sm text-emerald-200"
                : "rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-zinc-200 hover:bg-white/10"
            }
          >
            {(() => {
            const label = t(tab.labelKey);
            return label === tab.labelKey
              ? tab.id.charAt(0).toUpperCase() + tab.id.slice(1)
              : label;
          })()}
          </button>
        ))}
      </div>

      {activeTab === "general" && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <div className="text-sm font-semibold text-white">{t("settings.org.title")}</div>
            <div className="mt-4 space-y-3">
              <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                <div className="text-xs text-zinc-400">{t("settings.org.plantName")}</div>
                <div className="mt-1 text-sm text-zinc-300">{orgInfo?.name || t("common.loading")}</div>
                {orgInfo?.slug ? (
                  <div className="mt-1 text-[11px] text-zinc-500">
                    {t("settings.org.slug")}: {orgInfo.slug}
                  </div>
                ) : null}
              </div>
              <label className="block rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-zinc-400">
                {t("settings.org.timeZone")}
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
                {t("settings.updated")}:{" "}
                {draft.updatedAt ? new Date(draft.updatedAt).toLocaleString(locale) : t("common.na")}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
              <div className="mb-3 text-sm font-semibold text-white">{t("settings.defaults")}</div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                <label className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-zinc-400">
                  {t("settings.defaults.moldTotal")}
                  <input
                    type="number"
                    min={0}
                    value={draft.defaults.moldTotal}
                    onChange={(event) => updateDefaults("moldTotal", Number(event.target.value))}
                    className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
                  />
                </label>
                <label className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-zinc-400">
                  {t("settings.defaults.moldActive")}
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
              <div className="mb-3 text-sm font-semibold text-white">{t("settings.integrations")}</div>
              <div className="space-y-3 text-sm text-zinc-300">
                <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                  <div className="text-xs text-zinc-400">{t("settings.integrations.webhook")}</div>
                  <div className="mt-1 text-sm text-white">https://hooks.example.com/iiot</div>
                </div>
                <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                  <div className="text-xs text-zinc-400">{t("settings.integrations.erp")}</div>
                  <div className="mt-1 text-sm text-zinc-300">{t("settings.integrations.erpNotConfigured")}</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      {activeTab === "modules" && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <div className="text-sm font-semibold text-white">{t("settings.modules.title")}</div>
            <div className="mt-1 text-xs text-zinc-400">{t("settings.modules.subtitle")}</div>

            <div className="mt-4 space-y-3">
              <Toggle
                label={t("settings.modules.screenless.title")}
                helper={t("settings.modules.screenless.helper")}
                enabled={draft.modules.screenlessMode}
                onChange={(next) =>
                  setDraft((prev) =>
                    prev
                      ? {
                          ...prev,
                          modules: { ...prev.modules, screenlessMode: next },
                        }
                      : prev
                  )
                }
              />
            </div>

            <div className="mt-3 text-xs text-zinc-500">
              Org-wide setting. Hides Downtime from navigation for all users in this org.
            </div>
          </div>
        </div>
      )}



      {activeTab === "thresholds" && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <div className="mb-3 flex items-center justify-between gap-4">
              <div className="text-sm font-semibold text-white">{t("settings.thresholds")}</div>
              <div className="text-xs text-zinc-400">{t("settings.thresholds.appliesAll")}</div>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <label className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-zinc-400">
                {t("settings.thresholds.oee")} (%)
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
                {t("settings.thresholds.stoppage")}
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
                {t("settings.thresholds.macroStoppage")}
                <input
                  type="number"
                  min={1.1}
                  max={20}
                  step={0.1}
                  value={draft.thresholds.macroStoppageMultiplier}
                  onChange={(event) =>
                    updateThreshold("macroStoppageMultiplier", Number(event.target.value))
                  }
                  className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
                />
              </label>
              <label className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-zinc-400">
                {t("settings.thresholds.performance")} (%)
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
                {t("settings.thresholds.qualitySpike")} (%)
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
      )}

      {activeTab === "shifts" && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <div className="mb-3 flex items-center justify-between gap-4">
              <div className="text-sm font-semibold text-white">{t("settings.shiftSchedule")}</div>
              <div className="text-xs text-zinc-400">{t("settings.shiftHint")}</div>
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
                      {t("settings.shiftRemove")}
                    </button>
                  </div>
                  <div className="mt-3 flex items-center gap-2">
                    <input
                      type="time"
                      value={shift.start}
                      onChange={(event) => updateShift(index, { start: event.target.value })}
                      className="w-full rounded-md border border-white/10 bg-black/30 px-2 py-1 text-sm text-white"
                    />
                    <span className="text-xs text-zinc-400">{t("settings.shiftTo")}</span>
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
                    {t("settings.shiftEnabled")}
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
                {t("settings.shiftAdd")}
              </button>
              <div className="flex flex-1 flex-wrap gap-3">
                <label className="flex-1 rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-zinc-400">
                  {t("settings.shiftCompLabel")}
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
                  {t("settings.lunchBreakLabel")}
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
            <div className="mb-2 text-sm font-semibold text-white">{t("settings.shiftOverrides.title")}</div>
            <div className="text-xs text-zinc-400">{t("settings.shiftOverrides.subtitle")}</div>
            <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
              {shiftOverrideDays.map((day) => {
                const dayOverrides = draft.shiftSchedule.overrides?.[day.key];
                const overrideShifts = dayOverrides ?? [];
                const isCustom = dayOverrides !== undefined;
                return (
                  <div key={day.key} className="rounded-xl border border-white/10 bg-black/20 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-semibold text-white">{day.label}</div>
                      <button
                        type="button"
                        onClick={() => toggleShiftOverride(day.key)}
                        className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-white"
                      >
                        {isCustom
                          ? t("settings.shiftOverrides.useDefault")
                          : t("settings.shiftOverrides.customize")}
                      </button>
                    </div>

                    {!isCustom && (
                      <div className="mt-2 text-xs text-zinc-400">{t("settings.shiftOverrides.inherits")}</div>
                    )}

                    {isCustom && (
                      <>
                        {overrideShifts.length === 0 ? (
                          <div className="mt-2 text-xs text-zinc-400">
                            {t("settings.shiftOverrides.dayOff")}
                          </div>
                        ) : (
                          <div className="mt-3 space-y-2">
                            {overrideShifts.map((shift, index) => (
                              <div key={`${day.key}-${index}`} className="rounded-lg border border-white/10 bg-black/30 p-2">
                                <div className="flex items-center justify-between gap-2">
                                  <input
                                    value={shift.name}
                                    onChange={(event) =>
                                      updateShiftOverride(day.key, index, { name: event.target.value })
                                    }
                                    className="w-full rounded-md border border-white/10 bg-black/30 px-2 py-1 text-xs text-white"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => removeShiftOverride(day.key, index)}
                                    className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-white"
                                  >
                                    {t("settings.shiftRemove")}
                                  </button>
                                </div>
                                <div className="mt-2 flex items-center gap-2">
                                  <input
                                    type="time"
                                    value={shift.start}
                                    onChange={(event) =>
                                      updateShiftOverride(day.key, index, { start: event.target.value })
                                    }
                                    className="w-full rounded-md border border-white/10 bg-black/30 px-2 py-1 text-xs text-white"
                                  />
                                  <span className="text-xs text-zinc-400">{t("settings.shiftTo")}</span>
                                  <input
                                    type="time"
                                    value={shift.end}
                                    onChange={(event) =>
                                      updateShiftOverride(day.key, index, { end: event.target.value })
                                    }
                                    className="w-full rounded-md border border-white/10 bg-black/30 px-2 py-1 text-xs text-white"
                                  />
                                </div>
                                <div className="mt-2 flex items-center gap-2 text-xs text-zinc-400">
                                  <input
                                    type="checkbox"
                                    checked={shift.enabled}
                                    onChange={(event) =>
                                      updateShiftOverride(day.key, index, { enabled: event.target.checked })
                                    }
                                    className="h-4 w-4 rounded border border-white/20 bg-black/20"
                                  />
                                  {t("settings.shiftEnabled")}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}

                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => addShiftOverride(day.key)}
                            disabled={overrideShifts.length >= 3}
                            className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-white disabled:opacity-40"
                          >
                            {t("settings.shiftAdd")}
                          </button>
                          <button
                            type="button"
                            onClick={() => clearShiftOverride(day.key)}
                            className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-white"
                          >
                            {t("settings.shiftOverrides.clear")}
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {activeTab === "alerts" && (
        <div className="space-y-6">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <div className="text-sm font-semibold text-white">{t("settings.alerts")}</div>
            <div className="mt-4 space-y-3">
              <Toggle
                label={t("settings.alerts.oeeDrop")}
                helper={t("settings.alerts.oeeDropHelper")}
                enabled={draft.alerts.oeeDropEnabled}
                onChange={(next) => updateAlerts("oeeDropEnabled", next)}
              />
              <Toggle
                label={t("settings.alerts.performanceDegradation")}
                helper={t("settings.alerts.performanceDegradationHelper")}
                enabled={draft.alerts.performanceDegradationEnabled}
                onChange={(next) => updateAlerts("performanceDegradationEnabled", next)}
              />
              <Toggle
                label={t("settings.alerts.qualitySpike")}
                helper={t("settings.alerts.qualitySpikeHelper")}
                enabled={draft.alerts.qualitySpikeEnabled}
                onChange={(next) => updateAlerts("qualitySpikeEnabled", next)}
              />
              <Toggle
                label={t("settings.alerts.predictive")}
                helper={t("settings.alerts.predictiveHelper")}
                enabled={draft.alerts.predictiveOeeDeclineEnabled}
                onChange={(next) => updateAlerts("predictiveOeeDeclineEnabled", next)}
              />
            </div>
          </div>

          <AlertsConfig />
        </div>
      )}

      {activeTab === "financial" && (
        <div className="space-y-6">
          <FinancialCostConfig />
        </div>
      )}

      {activeTab === "team" && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-semibold text-white">{t("settings.team")}</div>
              <div className="text-xs text-zinc-400">{t("settings.teamTotal", { count: members.length })}</div>
            </div>

            {teamLoading && <div className="text-sm text-zinc-400">{t("settings.loadingTeam")}</div>}
            {teamError && (
              <div className="rounded-xl border border-red-500/20 bg-red-500/10 p-3 text-sm text-red-200">
                {teamError}
              </div>
            )}

            {!teamLoading && !teamError && members.length === 0 && (
              <div className="text-sm text-zinc-400">{t("settings.teamNone")}</div>
            )}

            {!teamLoading && !teamError && members.length > 0 && (
              <div className="space-y-2">
                {members.map((member) => (
                  <div
                    key={member.membershipId}
                    className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-black/20 p-3"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-white">
                        {member.name || member.email}
                      </div>
                      <div className="truncate text-xs text-zinc-400">{member.email}</div>
                    </div>
                    <div className="flex flex-col items-end gap-1 text-xs text-zinc-400">
                      <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-white">
                        {formatRole(member.role)}
                      </span>
                      {!member.isActive ? (
                        <span className="rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 text-red-200">
                          {t("settings.role.inactive")}
                        </span>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-white/10 bg-white/5 p-5">
            <div className="mb-3 text-sm font-semibold text-white">{t("settings.invites")}</div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <label className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-zinc-400">
                {t("settings.inviteEmail")}
                <input
                  value={inviteEmail}
                  onChange={(event) => setInviteEmail(event.target.value)}
                  className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
                />
              </label>
              <label className="rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-zinc-400">
                {t("settings.inviteRole")}
                <select
                  value={inviteRole}
                  onChange={(event) => setInviteRole(event.target.value)}
                  className="mt-2 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-sm text-white"
                >
                  <option value="MEMBER">{t("settings.inviteRole.member")}</option>
                  <option value="ADMIN">{t("settings.inviteRole.admin")}</option>
                  <option value="OWNER">{t("settings.inviteRole.owner")}</option>
                </select>
              </label>
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={createInvite}
                disabled={inviteSubmitting}
                className="rounded-xl border border-emerald-400/40 bg-emerald-500/20 px-4 py-2 text-sm text-emerald-100 hover:bg-emerald-500/30 disabled:opacity-60"
              >
                {inviteSubmitting ? t("settings.inviteSending") : t("settings.inviteSend")}
              </button>
              <button
                type="button"
                onClick={loadTeam}
                className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white hover:bg-white/10"
              >
                {t("settings.refresh")}
              </button>
              {inviteStatus && <div className="text-xs text-zinc-400">{inviteStatus}</div>}
            </div>

            <div className="mt-4 space-y-3">
              {invites.length === 0 && (
                <div className="text-sm text-zinc-400">{t("settings.inviteNone")}</div>
              )}
              {invites.map((invite) => (
                <div key={invite.id} className="rounded-xl border border-white/10 bg-black/20 p-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold text-white">{invite.email}</div>
                      <div className="text-xs text-zinc-400">
                        {formatRole(invite.role)} -{" "}
                        {t("settings.inviteExpires", {
                          date: new Date(invite.expiresAt).toLocaleDateString(locale),
                        })}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => copyInviteLink(invite.token)}
                        className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-white hover:bg-white/10"
                      >
                        {t("settings.inviteCopy")}
                      </button>
                      <button
                        type="button"
                        onClick={() => revokeInvite(invite.id)}
                        className="rounded-lg border border-red-500/30 bg-red-500/10 px-2 py-1 text-xs text-red-200 hover:bg-red-500/20"
                      >
                        {t("settings.inviteRevoke")}
                      </button>
                    </div>
                  </div>
                  <div className="mt-2 rounded-lg border border-white/10 bg-black/30 px-2 py-1 text-xs text-zinc-400">
                    {buildInviteUrl(invite.token)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
