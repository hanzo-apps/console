import { NextResponse, type NextRequest } from "next/server";

/**
 * Canonical URL surface — exactly one way: `/v1/*`.
 *
 * The Pages Router forces handler files under `pages/api/`, but the published
 * surface is `/v1/*`. We do this in middleware (not next.config rewrites)
 * because this app has `i18n` configured, and Next prefixes config-rewrite
 * sources/destinations with the locale (`/en/...`) — which breaks rewrites onto
 * locale-agnostic API routes. Middleware runs before i18n on the raw path, so
 * the mapping is exact and reliable.
 *
 *   • /v1/<seg>/*            → /api/<seg>/*           (PASS_THROUGH: name kept)
 *   • /v1/{prompts,scores}/* → /api/public/v2/<seg>/* (current version is v2)
 *   • /v1/traces/<id>/download → /api/traces/<id>/download (internal export)
 *   • /v1/*                  → /api/public/*          (public SDK API catch-all)
 *   • legacy /api/* (the above, inverted) → 307 redirect to /v1/*
 *
 * This is the ONE source of truth for the surface; next.config has no rewrites.
 */
const PASS_THROUGH = new Set([
  "auth",
  "trpc",
  "admin",
  "agents",
  "billing",
  "compute",
  "dashboard",
  "feedback",
  "kms",
  "observe",
  "start-cron",
  "support",
  "zap",
  "chatCompletion",
  "in-app-agent",
]);
const V2 = new Set(["prompts", "scores"]);

export function middleware(req: NextRequest) {
  const url = req.nextUrl;
  const p = url.pathname;

  // ── Canonical /v1/* → physical /api route (internal rewrite) ──────────────
  if (p.startsWith("/v1/")) {
    const rest = p.slice("/v1/".length); // e.g. "ready", "iam/session", "admin/x"
    const seg = rest.split("/")[0];
    let to: string;
    if (rest.startsWith("traces/") && rest.endsWith("/download")) {
      to = `/api/${rest}`; // internal trace export
    } else if (PASS_THROUGH.has(seg)) {
      to = `/api/${rest}`;
    } else if (V2.has(seg)) {
      to = `/api/public/v2/${rest}`;
    } else {
      to = `/api/public/${rest}`; // public SDK API
    }
    const dest = url.clone();
    dest.pathname = to;
    return NextResponse.rewrite(dest);
  }

  // ── Legacy /api/* → 307 redirect to canonical /v1/* ───────────────────────
  if (p.startsWith("/api/")) {
    let to: string | null = null;
    if (p.startsWith("/api/public/")) {
      const rest = p.slice("/api/public/".length);
      const m = rest.match(/^v2\/(prompts|scores)(\/.*)?$/);
      to = m ? `/v1/${m[1]}${m[2] ?? ""}` : `/v1/${rest}`;
    } else {
      const seg = p.split("/")[2];
      if (seg && PASS_THROUGH.has(seg)) to = `/v1/${p.slice("/api/".length)}`;
    }
    if (to) {
      const dest = url.clone();
      dest.pathname = to;
      return NextResponse.redirect(dest, 307);
    }
  }

  return NextResponse.next();
}

// Only run on the two surfaces we map; everything else skips middleware.
export const config = { matcher: ["/v1/:path*", "/api/:path*"] };
