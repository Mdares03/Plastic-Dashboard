export function getBaseUrl(req?: Request) {
  const envUrl = process.env.APP_BASE_URL || process.env.NEXT_PUBLIC_APP_URL;
  if (envUrl) return String(envUrl).replace(/\/+$/, "");
  if (!req) return "http://localhost:3000";

  const forwardedProto = req.headers.get("x-forwarded-proto");
  const proto = forwardedProto ? forwardedProto.split(",")[0].trim() : new URL(req.url).protocol.replace(":", "");
  const host =
    req.headers.get("x-forwarded-host") ||
    req.headers.get("host") ||
    new URL(req.url).host;

  return `${proto}://${host}`;
}
