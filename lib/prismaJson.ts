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

/**
 * Like toJsonValue, but bounds the serialized size so diagnostic logs (e.g. IngestLog.body)
 * cannot balloon the database during an error storm. If the payload serializes larger than
 * `maxBytes`, store a truncated preview marker instead of the full body.
 */
export function boundedJsonValue(value: unknown, maxBytes = 2048): Prisma.InputJsonValue {
  if (value === null || value === undefined) {
    return Prisma.JsonNull as unknown as Prisma.InputJsonValue;
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return { _truncated: true, reason: "unserializable" };
  }
  if (serialized.length <= maxBytes) {
    return toJsonValue(value);
  }
  return {
    _truncated: true,
    originalLength: serialized.length,
    preview: serialized.slice(0, maxBytes),
  };
}

export function toNullableJsonValue(
  value: unknown
): Prisma.NullableJsonNullValueInput | Prisma.InputJsonValue {
  if (value === null || value === undefined) return Prisma.DbNull;
  return toJsonValue(value);
}
