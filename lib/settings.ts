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

type AnyRecord = Record<string, any>;

function isPlainObject(value: any): value is AnyRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function normalizeAlerts(raw: any) {
  if (!isPlainObject(raw)) return { ...DEFAULT_ALERTS };
  return { ...DEFAULT_ALERTS, ...raw };
}

export function normalizeDefaults(raw: any) {
  if (!isPlainObject(raw)) return { ...DEFAULT_DEFAULTS };
  return { ...DEFAULT_DEFAULTS, ...raw };
}

export function buildSettingsPayload(settings: any, shifts: any[]) {
  const ordered = [...(shifts ?? [])].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
  const mappedShifts = ordered.map((s, idx) => ({
    name: s.name || `Shift ${idx + 1}`,
    start: s.startTime,
    end: s.endTime,
    enabled: s.enabled !== false,
  }));

  return {
    orgId: settings.orgId,
    version: settings.version,
    timezone: settings.timezone,
    shiftSchedule: {
      shifts: mappedShifts,
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
    defaults: normalizeDefaults(settings.defaultsJson),
    updatedAt: settings.updatedAt,
    updatedBy: settings.updatedBy,
  };
}

export function deepMerge(base: any, override: any): any {
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

export function applyOverridePatch(existing: any, patch: any) {
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

export function validateShiftSchedule(shifts: any[]) {
  if (!Array.isArray(shifts)) return { ok: false, error: "shifts must be an array" };
  if (shifts.length > 3) return { ok: false, error: "shifts max is 3" };

  const normalized = shifts.map((raw, idx) => {
    const start = String(raw?.start ?? "").trim();
    const end = String(raw?.end ?? "").trim();
    if (!TIME_RE.test(start) || !TIME_RE.test(end)) {
      return { error: `shift ${idx + 1} start/end must be HH:mm` };
    }
    const name = String(raw?.name ?? `Shift ${idx + 1}`).trim() || `Shift ${idx + 1}`;
    const enabled = raw?.enabled !== false;
    return {
      name,
      startTime: start,
      endTime: end,
      sortOrder: idx + 1,
      enabled,
    };
  });

  const firstError = normalized.find((s: any) => s?.error);
  if (firstError) return { ok: false, error: firstError.error };

  return { ok: true, shifts: normalized as any[] };
}

export function validateShiftFields(shiftChangeCompensationMin?: any, lunchBreakMin?: any) {
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

export function validateThresholds(thresholds: any) {
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

export function validateDefaults(defaults: any) {
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

export function pickUpdateValue(input: any) {
  return input === undefined ? undefined : input;
}

export function stripUndefined(obj: AnyRecord) {
  const out: AnyRecord = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) out[key] = value;
  }
  return out;
}
