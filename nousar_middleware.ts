import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  const { pathname, search } = req.nextUrl;

  // Skip auth for public routes + Next internals
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/api") ||
    pathname === "/login" ||
    pathname === "/signup" ||
    pathname === "/logout"
  ) {
    return NextResponse.next();
  }

  // TODO: replace with your real session cookie name
  const sessionId = req.cookies.get("sessionId")?.value;

  // Protect everything under the app
  if (!sessionId) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

// Limit the middleware to relevant paths
export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
