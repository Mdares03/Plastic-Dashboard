import { Prisma } from "@prisma/client";

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function toJsonValue(value: unknown): Prisma.InputJsonValue {
  if (value === null || value === undefined) {
    return Prisma.JsonNull as unknown as Prisma.InputJsonValue;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => (item === undefined ? (Prisma.JsonNull as unknown as Prisma.InputJsonValue) : toJsonValue(item)));
  }
  if (isRecord(value)) {
    const out: Record<string, Prisma.InputJsonValue> = {};
    for (const [key, val] of Object.entries(value)) {
      if (val === undefined) continue;
      out[key] = toJsonValue(val);
    }
    return out;
  }
  return String(value);
}

export function toNullableJsonValue(
  value: unknown
): Prisma.NullableJsonNullValueInput | Prisma.InputJsonValue {
  if (value === null || value === undefined) return Prisma.DbNull;
  return toJsonValue(value);
}
