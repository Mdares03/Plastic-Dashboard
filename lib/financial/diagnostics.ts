import { logLine } from "@/lib/logger";

export type FinancialDiagnostic = {
  code: "FINANCIAL_SCHEMA_DRIFT";
  message: string;
  recoverable: true;
};

type ErrorWithCode = {
  code?: unknown;
  message?: unknown;
  meta?: { column?: unknown } | unknown;
};

export function getErrorCode(error: unknown) {
  if (!error || typeof error !== "object") return null;
  const code = (error as ErrorWithCode).code;
  return typeof code === "string" ? code : null;
}

function getErrorMessage(error: unknown) {
  if (!error || typeof error !== "object") return "";
  const message = (error as ErrorWithCode).message;
  return typeof message === "string" ? message : "";
}

export function getMissingColumnName(error: unknown) {
  if (!error || typeof error !== "object") return null;
  const meta = (error as ErrorWithCode).meta;
  if (!meta || typeof meta !== "object") return null;
  const column = (meta as { column?: unknown }).column;
  return typeof column === "string" ? column : null;
}

export function isPrismaMissingColumnError(error: unknown) {
  if (getErrorCode(error) === "P2022") return true;
  const message = getErrorMessage(error).toLowerCase();
  return message.includes("does not exist in the current database");
}

export function createSchemaDriftDiagnostic(column?: string | null): FinancialDiagnostic {
  const suffix = column ? ` (${column})` : "";
  return {
    code: "FINANCIAL_SCHEMA_DRIFT",
    message: `Financial schema mismatch detected${suffix}. Showing partial data.`,
    recoverable: true,
  };
}

export function logFinancialSchemaDrift(params: {
  route: string;
  orgId: string;
  userId?: string | null;
  error: unknown;
}) {
  logLine("financial.schema_drift", {
    route: params.route,
    orgId: params.orgId,
    userId: params.userId ?? null,
    errorCode: getErrorCode(params.error),
    missingColumn: getMissingColumnName(params.error),
    message: getErrorMessage(params.error),
  });
}
