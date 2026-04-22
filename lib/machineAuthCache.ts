import { prisma } from "@/lib/prisma";

type MachineAuth = { id: string; orgId: string };

const TTL_MS = 10_000;
const MAX_SIZE = 1000;
const cache = new Map<string, { value: MachineAuth; expiresAt: number }>();

function makeKey(machineId: string, apiKey: string) {
  return `${machineId}:${apiKey}`;
}

export async function getMachineAuth(machineId: string, apiKey: string) {
  const key = makeKey(machineId, apiKey);
  const now = Date.now();
  const hit = cache.get(key);

  if (hit && hit.expiresAt > now) {
    return hit.value;
  }

  const machine = await prisma.machine.findFirst({
    where: { id: machineId, apiKey },
    select: { id: true, orgId: true },
  });

  if (!machine) {
    cache.delete(key);
    return null;
  }

  if (cache.size > MAX_SIZE) {
    cache.clear();
  }

  cache.set(key, { value: machine, expiresAt: now + TTL_MS });
  return machine;
}

export function invalidateMachineAuth(machineId: string) {
  const prefix = `${machineId}:`;
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) {
      cache.delete(key);
    }
  }
}
