/**
 * Alert throttling — the CEO-spam fix, as PURE decisions (no DB), so the
 * scenario that burned the pilot ("N identical event pings → one inbox flood")
 * is asserted by golden tests, not hoped for. The engine fetches state/counts and
 * feeds them here; this module decides send vs suppress.
 *
 * Two independent gates:
 *  1. Per-incident dedup (keyed on the edge's incidentKey): one "active" + one
 *     "resolved" notification per recipient/channel, with optional repeat for a
 *     still-unresolved incident.
 *  2. Circuit breaker: hard hourly ceilings per contact and per org. Even if (1)
 *     would allow a send, a recipient/org that hit its cap this hour is suppressed.
 */

export type StatusKey = "active" | "resolved";

export type IncidentNotifyState = {
  /**
   * When this exact (incidentKey, statusKey, role, channel, recipient) tuple was
   * last delivered, or null if never. Drives dedup + repeat.
   */
  lastSentAt: Date | null;
};

/**
 * Per-incident dedup. First notification of a given status always sends. A
 * `resolved` notification is one-and-done. An `active` notification repeats only
 * after `repeatMinutes` have elapsed (0/undefined = never repeat).
 */
export function shouldNotifyIncident(params: {
  state: IncidentNotifyState;
  statusKey: StatusKey;
  repeatMinutes?: number;
  now: Date;
}): boolean {
  const { state, statusKey, repeatMinutes, now } = params;
  if (state.lastSentAt == null) return true;
  if (statusKey === "resolved") return false;
  const repeat = Number(repeatMinutes ?? 0);
  if (!repeat || repeat <= 0) return false;
  return now.getTime() - state.lastSentAt.getTime() >= repeat * 60_000;
}

export type CircuitBreakerInput = {
  contactSentLastHour: number;
  orgSentLastHour: number;
  maxPerContactPerHour: number;
  maxPerOrgPerHour: number;
};

export type CircuitBreakerDecision =
  | { allowed: true }
  | { allowed: false; reason: "contact_cap" | "org_cap" };

/**
 * Hard hourly ceilings. Org cap is checked first (a single runaway machine must
 * not exhaust everyone's quota and then still be blamed on the contact). A cap of
 * 0 means "unlimited" for that dimension.
 */
export function checkCircuitBreaker(input: CircuitBreakerInput): CircuitBreakerDecision {
  const { contactSentLastHour, orgSentLastHour, maxPerContactPerHour, maxPerOrgPerHour } = input;
  if (maxPerOrgPerHour > 0 && orgSentLastHour >= maxPerOrgPerHour) {
    return { allowed: false, reason: "org_cap" };
  }
  if (maxPerContactPerHour > 0 && contactSentLastHour >= maxPerContactPerHour) {
    return { allowed: false, reason: "contact_cap" };
  }
  return { allowed: true };
}
