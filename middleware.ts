import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const COOKIE_NAME = "mis_session";

export function middleware(req: NextRequest) {
  try {
    const { pathname, search } = req.nextUrl;

    if (
      pathname.startsWith("/_next") ||
      pathname.startsWith("/favicon") ||
      pathname.startsWith("/public") ||
      pathname === "/login" ||
      pathname === "/signup" ||
      pathname === "/logout" ||
      pathname.startsWith("/invite") ||
      pathname.startsWith("/api")
    ) {
      return NextResponse.next();
    }

    const sessionId = req.cookies.get(COOKIE_NAME)?.value;

    if (!sessionId) {
      const url = req.nextUrl.clone();
      url.pathname = "/login";
      url.searchParams.set("next", pathname + search);
      return NextResponse.redirect(url);
    }

    return NextResponse.next();
  } catch (err) {
    console.error("[middleware]", err);
    return NextResponse.next();
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
