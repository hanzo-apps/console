import { NextResponse, type NextRequest } from "next/server";

// Canonical public API surface is /v1/* — clients (the @hanzo/iam BrowserIamSdk
// and the console session client) never call /api/. The Next Pages-Router
// handlers are framework-fixed under pages/api/public/iam/*, so we map
// /v1/iam/* -> /api/public/iam/* here.
//
// Why middleware and not next.config `rewrites()`: this app has `i18n`
// configured, and Next prefixes config-rewrite sources/destinations with the
// locale (`/en/...`), which breaks these locale-agnostic API routes. Middleware
// runs BEFORE i18n on the raw path, so the rewrite is correct here. Matcher is
// tightly scoped to the IAM surface — do not broaden without a scoped matcher.
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/v1/iam/")) {
    const url = req.nextUrl.clone();
    url.pathname = pathname.replace(/^\/v1\/iam\//, "/api/public/iam/");
    return NextResponse.rewrite(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/v1/iam/:path*"] };
