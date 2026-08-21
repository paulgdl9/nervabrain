import { NextRequest, NextResponse } from "next/server";
import {
  SESSION_COOKIE,
  configuredDashboardPassword,
  verifySessionToken,
} from "@/lib/dashboard-session";

// Next.js Proxy (the successor to Middleware) always runs on the Node.js
// runtime, so node:crypto's timingSafeEqual/createHmac (used for tamper-proof
// session cookie verification in dashboard-session.ts) are available here.

// Paths that must stay reachable without a session, so the login flow itself
// isn't blocked and static/internal assets aren't gated.
const PUBLIC_PATHS = ["/login"];

function isPublicPath(pathname: string) {
  if (PUBLIC_PATHS.includes(pathname)) return true;
  if (pathname.startsWith("/_next/")) return true;
  if (pathname === "/favicon.ico") return true;
  // Browsers fetch the PWA manifest without credentials (spec: manifest
  // requests omit cookies unless crossorigin="use-credentials"), so gating it
  // would break install-to-home-screen. It exposes only the app name/icons.
  if (pathname === "/manifest.webmanifest") return true;
  // OAuth discovery metadata is public by design (RFC 8414/9728): MCP clients
  // (e.g. Claude connectors) fetch it server-side with no session and no way
  // to log in. These documents expose no secrets and are already served with
  // Access-Control-Allow-Origin: *.
  if (pathname === "/.well-known" || pathname.startsWith("/.well-known/")) return true;
  // The OAuth consent page carries its own auth (capture-token form + rate
  // limit); gating it behind the dashboard session breaks the authorization
  // redirect from OAuth clients.
  if (pathname === "/authorize") return true;
  return false;
}

let warnedNoPassword = false;

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  const password = configuredDashboardPassword();
  if (!password) {
    if (!warnedNoPassword) {
      warnedNoPassword = true;
      console.warn(
        "[dashboard-auth] DASHBOARD_PASSWORD is not set: the dashboard GUI is unauthenticated. Set DASHBOARD_PASSWORD to protect it before exposing this app publicly.",
      );
    }
    return NextResponse.next();
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (verifySessionToken(token)) {
    return NextResponse.next();
  }

  const loginUrl = request.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = "";
  const from = `${pathname}${search}`;
  if (from && from !== "/") {
    loginUrl.searchParams.set("from", from);
  }
  return NextResponse.redirect(loginUrl);
}

export const config = {
  // Everything except /api/* (which has its own token/OAuth auth in
  // src/lib/auth.ts), Next internals, and common static assets.
  matcher: [
    "/((?!api/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js|map)$).*)",
  ],
};
