import crypto from "crypto";

/**
 * Short-lived signed token for the headless-PDF print routes (item 3).
 *
 * The print pages render a report for a specific org WITHOUT a logged-in session
 * (Puppeteer fetches them with no cookie). A session-authenticated API route mints
 * one of these HMAC tokens scoped to the caller's org + report, and the print page
 * verifies it server-side. Tokens expire in minutes so a leaked URL is inert.
 */

const TOKEN_TTL_MS = 5 * 60 * 1000;

export type PrintTokenPayload = {
  type: "weekly" | "daily";
  orgId: string;
  /** ISO window bounds; omitted = the report builder's default window. */
  from?: string;
  to?: string;
};

type SignedPayload = PrintTokenPayload & { exp: number };

function getSecret(): string {
  const secret = process.env.REPORT_PRINT_SECRET;
  if (!secret) throw new Error("REPORT_PRINT_SECRET not configured");
  return secret;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function hmac(body: string): string {
  return crypto.createHmac("sha256", getSecret()).update(body).digest("base64url");
}

export function signPrintToken(payload: PrintTokenPayload): string {
  const signed: SignedPayload = { ...payload, exp: Date.now() + TOKEN_TTL_MS };
  const body = base64url(JSON.stringify(signed));
  return `${body}.${hmac(body)}`;
}

export function verifyPrintToken(token: string | null | undefined): PrintTokenPayload | null {
  if (!token || typeof token !== "string") return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const expected = hmac(body);
  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;

  let parsed: SignedPayload;
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SignedPayload;
  } catch {
    return null;
  }
  if (typeof parsed.exp !== "number" || parsed.exp < Date.now()) return null;
  if (parsed.type !== "weekly" && parsed.type !== "daily") return null;
  if (typeof parsed.orgId !== "string" || !parsed.orgId) return null;

  return { type: parsed.type, orgId: parsed.orgId, from: parsed.from, to: parsed.to };
}
