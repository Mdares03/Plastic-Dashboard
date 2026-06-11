import { z } from "zod";

const ROLE_NAMES = ["MEMBER", "ADMIN", "OWNER"] as const;
const CHANNELS = ["email", "sms"] as const;
const EVENT_TYPES = ["macrostop", "microstop", "slow-cycle", "offline", "error"] as const;

const RoleRule = z.object({
  enabled: z.boolean(),
  afterMinutes: z.number().int().min(0),
  channels: z.array(z.enum(CHANNELS)).default(["email"]),
});

const Rule = z.object({
  id: z.string(),
  eventType: z.enum(EVENT_TYPES),
  roles: z.record(z.enum(ROLE_NAMES), RoleRule),
  repeatMinutes: z.number().int().min(0).optional(),
});

const DigestConfig = z.object({
  enabled: z.boolean().default(false),
  windowMinutes: z.number().int().min(1).default(60),
});

export const AlertPolicySchema = z.object({
  version: z.number().int().min(1).default(1),
  // Master switch. When false, no alert notifications are sent regardless of
  // per-role/per-event rules. Defaults to true so existing policies (which
  // predate this field) keep their current behavior.
  enabled: z.boolean().default(true),
  // Circuit breaker (the CEO-spam fix). Hard hourly ceilings independent of the
  // per-incident dedup: once a recipient or the org hits its cap within a rolling
  // hour, further sends are suppressed (recorded, not delivered). 0 = unlimited.
  maxPerContactPerHour: z.number().int().min(0).default(10),
  maxPerOrgPerHour: z.number().int().min(0).default(60),
  digest: DigestConfig.optional(),
  defaults: z.record(z.enum(ROLE_NAMES), RoleRule),
  rules: z.array(Rule),
});

export type AlertPolicy = z.infer<typeof AlertPolicySchema>;

export const DEFAULT_POLICY: AlertPolicy = {
  version: 1,
  enabled: true,
  maxPerContactPerHour: 10,
  maxPerOrgPerHour: 60,
  defaults: {
    MEMBER: { enabled: true, afterMinutes: 0, channels: ["email"] },
    ADMIN: { enabled: true, afterMinutes: 10, channels: ["email", "sms"] },
    OWNER: { enabled: true, afterMinutes: 30, channels: ["sms"] },
  },
  rules: EVENT_TYPES.map((eventType) => ({
    id: eventType,
    eventType,
    roles: {
      MEMBER: { enabled: true, afterMinutes: 0, channels: ["email"] },
      ADMIN: { enabled: true, afterMinutes: 10, channels: ["email", "sms"] },
      OWNER: { enabled: true, afterMinutes: 30, channels: ["sms"] },
    },
    repeatMinutes: 15,
  })),
};

export function normalizeAlertPolicy(raw: unknown): AlertPolicy {
  const parsed = AlertPolicySchema.safeParse(raw);
  if (parsed.success) return parsed.data;
  return DEFAULT_POLICY;
}

export function isRoleName(value: string) {
  return ROLE_NAMES.includes(value as (typeof ROLE_NAMES)[number]);
}

export function isChannel(value: string) {
  return CHANNELS.includes(value as (typeof CHANNELS)[number]);
}
