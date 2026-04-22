const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export const DEFAULT_ALERTS = {
  oeeDropEnabled: true,
  performanceDegradationEnabled: true,
  qualitySpikeEnabled: true,
  predictiveOeeDeclineEnabled: true,
};

export const DEFAULT_DEFAULTS = {
  moldTotal: 1,
  moldActive: 1,
};

export const DEFAULT_SHIFT = {
  name: "Shift 1",
  start: "06:00",
  end: "15:00",
};

export const SHIFT_OVERRIDE_DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type ShiftOverrideDay = (typeof SHIFT_OVERRIDE_DAYS)[number];

type AnyRecord = Record<string, unknown>;

function isPlainObject(value: unknown): value is AnyRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function normalizeAlerts(raw: unknown) {
  if (!isPlainObject(raw)) return { ...DEFAULT_ALERTS };
  return { ...DEFAULT_ALERTS, ...raw };
}

export function normalizeDefaults(raw: unknown) {
  if (!isPlainObject(raw)) return { ...DEFAULT_DEFAULTS };
  return { ...DEFAULT_DEFAULTS, ...raw };
}

type SettingsRow = {
  orgId: string;
  version: number;
  timezone: string;
  shiftChangeCompMin?: number | null;
  lunchBreakMin?: number | null;
  shiftScheduleOverridesJson?: unknown;
  stoppageMultiplier?: number | null;
  macroStoppageMultiplier?: number | null;
  oeeAlertThresholdPct?: number | null;
  performanceThresholdPct?: number | null;
  qualitySpikeDeltaPct?: number | null;
  alertsJson?: unknown;
  defaultsJson?: unknown;
  updatedAt?: Date | string | null;
  updatedBy?: string | null;
};

type ShiftRow = {
  name?: string | null;
  startTime?: string | null;
  endTime?: string | null;
  enabled?: boolean | null;
  sortOrder?: number | null;
};

type ShiftOverridePayload = {
  name: string;
  start: string;
  end: string;
  enabled: boolean;
};

export function buildSettingsPayload(settings: SettingsRow, shifts: ShiftRow[]) {
  const ordered = [...(shifts ?? [])].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const mappedShifts = ordered.map((s, idx) => ({
    name: s.name || `Shift ${idx + 1}`,
    start: s.startTime,
    end: s.endTime,
    enabled: s.enabled !== false,
  }));
  const overrides = normalizeShiftOverrides(settings.shiftScheduleOverridesJson);

  const defaults = normalizeDefaults(settings.defaultsJson);
  const reasonCatalog =
    isPlainObject(settings.defaultsJson) && "reasonCatalog" in settings.defaultsJson
      ? (settings.defaultsJson as AnyRecord).reasonCatalog
      : null;

  return {
    orgId: settings.orgId,
    version: settings.version,
    timezone: settings.timezone,
    shiftSchedule: {
      shifts: mappedShifts,
      overrides: overrides && Object.keys(overrides).length ? overrides : undefined,
      shiftChangeCompensationMin: settings.shiftChangeCompMin,
      lunchBreakMin: settings.lunchBreakMin,
    },
    thresholds: {
      stoppageMultiplier: settings.stoppageMultiplier,
      macroStoppageMultiplier: settings.macroStoppageMultiplier,
      oeeAlertThresholdPct: settings.oeeAlertThresholdPct,
      performanceThresholdPct: settings.performanceThresholdPct,
      qualitySpikeDeltaPct: settings.qualitySpikeDeltaPct,
    },
    alerts: normalizeAlerts(settings.alertsJson),
    defaults,
    reasonCatalog: reasonCatalog ?? undefined,
    reasonCatalogData: reasonCatalog ?? undefined,
    reasonCatalogVersion: Number((reasonCatalog as AnyRecord | null)?.version ?? 1),
    updatedAt: settings.updatedAt,
    updatedBy: settings.updatedBy,
  };
}

export function deepMerge(base: unknown, override: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(override)) return override;
  const out: AnyRecord = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue;
    if (isPlainObject(value) && isPlainObject(out[key])) {
      out[key] = deepMerge(out[key], value);
    } else {
      out[key] = value;
    }
  }
  return out;
}

export function applyOverridePatch(existing: unknown, patch: unknown) {
  const base: AnyRecord = isPlainObject(existing) ? { ...existing } : {};
  if (!isPlainObject(patch)) return base;

  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete base[key];
      continue;
    }

    if (isPlainObject(value)) {
      const merged = applyOverridePatch(isPlainObject(base[key]) ? base[key] : {}, value);
      if (Object.keys(merged).length === 0) {
        delete base[key];
      } else {
        base[key] = merged;
      }
      continue;
    }

    base[key] = value;
  }

  return base;
}

type NormalizedShift = {
  name: string;
  startTime: string;
  endTime: string;
  sortOrder: number;
  enabled: boolean;
};

type ShiftValidationResult = NormalizedShift | { error: string };

export function validateShiftSchedule(shifts: unknown) {
  if (!Array.isArray(shifts)) return { ok: false, error: "shifts must be an array" };
  if (shifts.length > 3) return { ok: false, error: "shifts max is 3" };

  const normalized: ShiftValidationResult[] = shifts.map((raw, idx) => {
    const record = isPlainObject(raw) ? raw : {};
    const start = String(record.start ?? "").trim();
    const end = String(record.end ?? "").trim();
    if (!TIME_RE.test(start) || !TIME_RE.test(end)) {
      return { error: `shift ${idx + 1} start/end must be HH:mm` };
    }
    const name = String(record.name ?? `Shift ${idx + 1}`).trim() || `Shift ${idx + 1}`;
    const enabled = record.enabled !== false;
    return {
      name,
      startTime: start,
      endTime: end,
      sortOrder: idx + 1,
      enabled,
    };
  });

  const firstError = normalized.find((s): s is { error: string } => "error" in s);
  if (firstError) return { ok: false, error: firstError.error };

  return { ok: true, shifts: normalized as NormalizedShift[] };
}

export function validateShiftOverrides(overrides: unknown) {
  if (overrides === null) {
    return { ok: true, overrides: null as Record<string, ShiftOverridePayload[]> | null } as const;
  }
  if (!isPlainObject(overrides)) {
    return { ok: false, error: "shift overrides must be an object" } as const;
  }

  const normalized: Record<string, ShiftOverridePayload[]> = {};
  for (const [key, value] of Object.entries(overrides)) {
    if (!SHIFT_OVERRIDE_DAYS.includes(key as ShiftOverrideDay)) {
      return { ok: false, error: `invalid shift override day: ${key}` } as const;
    }
    const shiftResult = validateShiftSchedule(value);
    if (!shiftResult.ok) {
      return { ok: false, error: `shift overrides ${key}: ${shiftResult.error}` } as const;
    }
    normalized[key] =
      shiftResult.shifts?.map((s) => ({
        name: s.name,
        start: s.startTime,
        end: s.endTime,
        enabled: s.enabled !== false,
      })) ?? [];
  }

  return { ok: true, overrides: normalized } as const;
}

export function normalizeShiftOverrides(raw: unknown) {
  if (!isPlainObject(raw)) return undefined;
  const out: Record<string, ShiftOverridePayload[]> = {};
  for (const day of SHIFT_OVERRIDE_DAYS) {
    const value = raw[day];
    if (!Array.isArray(value)) continue;
    const normalized = value
      .map((entry, idx) => {
        const record = isPlainObject(entry) ? entry : {};
        const start = String(record.start ?? record.startTime ?? "").trim();
        const end = String(record.end ?? record.endTime ?? "").trim();
        if (!TIME_RE.test(start) || !TIME_RE.test(end)) return null;
        const name = String(record.name ?? `Shift ${idx + 1}`).trim() || `Shift ${idx + 1}`;
        const enabled = record.enabled !== false;
        return { name, start, end, enabled };
      })
      .filter((entry): entry is ShiftOverridePayload => !!entry);
    out[day] = normalized;
  }
  return out;
}

export function validateShiftFields(shiftChangeCompensationMin?: unknown, lunchBreakMin?: unknown) {
  if (shiftChangeCompensationMin != null) {
    const v = Number(shiftChangeCompensationMin);
    if (!Number.isFinite(v) || v < 0 || v > 480) {
      return { ok: false, error: "shiftChangeCompensationMin must be 0-480" };
    }
  }
  if (lunchBreakMin != null) {
    const v = Number(lunchBreakMin);
    if (!Number.isFinite(v) || v < 0 || v > 480) {
      return { ok: false, error: "lunchBreakMin must be 0-480" };
    }
  }
  return { ok: true };
}

export function validateThresholds(thresholds: unknown) {
  if (!isPlainObject(thresholds)) return { ok: true };

  const stoppage = thresholds.stoppageMultiplier;
  if (stoppage != null) {
    const v = Number(stoppage);
    if (!Number.isFinite(v) || v < 1.1 || v > 5.0) {
      return { ok: false, error: "stoppageMultiplier must be 1.1-5.0" };
    }
  }

  const macroStoppage = thresholds.macroStoppageMultiplier;
  if (macroStoppage != null) {
    const v = Number(macroStoppage);
    if (!Number.isFinite(v) || v < 1.1 || v > 20.0) {
      return { ok: false, error: "macroStoppageMultiplier must be 1.1-20.0" };
    }
  }

  const oee = thresholds.oeeAlertThresholdPct;
  if (oee != null) {
    const v = Number(oee);
    if (!Number.isFinite(v) || v < 50 || v > 100) {
      return { ok: false, error: "oeeAlertThresholdPct must be 50-100" };
    }
  }

  const perf = thresholds.performanceThresholdPct;
  if (perf != null) {
    const v = Number(perf);
    if (!Number.isFinite(v) || v < 50 || v > 100) {
      return { ok: false, error: "performanceThresholdPct must be 50-100" };
    }
  }

  const quality = thresholds.qualitySpikeDeltaPct;
  if (quality != null) {
    const v = Number(quality);
    if (!Number.isFinite(v) || v < 0 || v > 100) {
      return { ok: false, error: "qualitySpikeDeltaPct must be 0-100" };
    }
  }

  return { ok: true };
}

export function validateDefaults(defaults: unknown) {
  if (!isPlainObject(defaults)) return { ok: true };

  const moldTotal = defaults.moldTotal != null ? Number(defaults.moldTotal) : null;
  const moldActive = defaults.moldActive != null ? Number(defaults.moldActive) : null;

  if (moldTotal != null && (!Number.isFinite(moldTotal) || moldTotal < 0)) {
    return { ok: false, error: "moldTotal must be >= 0" };
  }

  if (moldActive != null && (!Number.isFinite(moldActive) || moldActive < 0)) {
    return { ok: false, error: "moldActive must be >= 0" };
  }

  if (moldTotal != null && moldActive != null && moldActive > moldTotal) {
    return { ok: false, error: "moldActive must be <= moldTotal" };
  }

  return { ok: true };
}

export function pickUpdateValue(input: unknown) {
  return input === undefined ? undefined : input;
}

export function stripUndefined(obj: AnyRecord) {
  const out: AnyRecord = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}
