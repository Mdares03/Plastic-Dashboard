export const COOKIE_NAME = "mis_session";
export const SESSION_DAYS = 7;

export function isSecureRequest(req: Request) {
  const forwardedProto = req.headers.get("x-forwarded-proto");
  if (forwardedProto) {
    return forwardedProto.split(",")[0].trim() === "https";
  }
  return new URL(req.url).protocol === "https:";
}

export function buildSessionCookieOptions(req: Request) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: isSecureRequest(req),
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  };
}
