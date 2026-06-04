type WorkOrderBlockCandidate = {
  machineId?: string | null;
  workOrderId?: string | null;
  sku?: string | null;
};

type WorkOrderBlockRule = {
  machineId: string | null;
  workOrderId: string | null;
  sku: string | null;
};

function normalize(value: string | null | undefined): string | null {
  const v = value?.trim();
  if (!v) return null;
  return v.toUpperCase();
}

function parseRule(token: string): WorkOrderBlockRule | null {
  const trimmed = token.trim();
  if (!trimmed) return null;

  // Supported formats:
  // 1) WO_ID
  // 2) MACHINE_ID:WO_ID
  // 3) MACHINE_ID:WO_ID:SKU
  const parts = trimmed
    .split(":")
    .map((p) => normalize(p))
    .filter((p): p is string => !!p);

  if (!parts.length || parts.length > 3) return null;
  if (parts.length === 1) return { machineId: null, workOrderId: parts[0], sku: null };
  if (parts.length === 2) return { machineId: parts[0], workOrderId: parts[1], sku: null };
  return { machineId: parts[0], workOrderId: parts[1], sku: parts[2] };
}

function parseRules(raw: string): WorkOrderBlockRule[] {
  return raw
    .split(",")
    .map((token) => parseRule(token))
    .filter((rule): rule is WorkOrderBlockRule => !!rule);
}

function matches(rule: WorkOrderBlockRule, candidate: WorkOrderBlockCandidate): boolean {
  const machineId = normalize(candidate.machineId);
  const workOrderId = normalize(candidate.workOrderId);
  const sku = normalize(candidate.sku);

  if (rule.workOrderId && rule.workOrderId !== workOrderId) return false;
  if (rule.machineId && rule.machineId !== machineId) return false;
  if (rule.sku && rule.sku !== sku) return false;
  return true;
}

// No default blocked work orders. Use TEMP_BLOCKED_WORK_ORDERS for temporary blocks.
const DEFAULT_TEMP_BLOCKED_WORK_ORDERS = "";

const defaultRules = DEFAULT_TEMP_BLOCKED_WORK_ORDERS;

const configuredRules = parseRules(
  [defaultRules, process.env.TEMP_BLOCKED_WORK_ORDERS ?? ""]
    .filter(Boolean)
    .join(",")
);

export function isTemporarilyBlockedWorkOrder(candidate: WorkOrderBlockCandidate): boolean {
  if (!configuredRules.length) return false;
  if (!candidate.workOrderId) return false;
  return configuredRules.some((rule) => matches(rule, candidate));
}
