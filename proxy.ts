import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

const PROTECTED = ["/portfolios", "/sets", "/cards", "/decks", "/alerts", "/dev"];

/** Optimistic redirect only (cookie presence, not validity). The real check is
 *  getSession() in app/(app)/layout.tsx — never rely on this alone. */
export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const passThrough = () => {
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set("x-pathname", pathname + request.nextUrl.search);
    return NextResponse.next({ request: { headers: requestHeaders } });
  };
  if (!PROTECTED.some((p) => pathname === p || pathname.startsWith(p + "/"))) return passThrough();
  if (getSessionCookie(request)) return passThrough();
  const url = new URL("/sign-in", request.url);
  url.searchParams.set("next", pathname + request.nextUrl.search);
  return NextResponse.redirect(url);
}

// NOTE: /api is excluded wholesale; new /api routes must call getSession() themselves.
export const config = { matcher: ["/((?!api|_next|favicon.ico).*)"] };
