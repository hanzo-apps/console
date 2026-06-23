import { createServiceProxy } from "@/src/server/service-proxy";

/**
 * Same-origin SSO proxy for the Hanzo Base admin dashboard.
 *
 * Forwards /api/base/* to ${BASE_DASHBOARD_URL}/* with session-derived tenant
 * headers injected. The Base admin UI lives at /_/, so the embed iframe points
 * at /api/base/_/ and the proxy passes the path straight through. Loaded by the
 * embedded Base dashboard iframe so the console IAM session authenticates Base
 * with no separate login.
 *
 * BASE_DASHBOARD_URL is server-only and never exposed to the client.
 */
// Next.js requires the page `config` export to be a statically analyzable
// object literal (an imported reference trips "Invalid segment configuration").
export const config = {
  api: {
    bodyParser: false,
    responseLimit: false,
  },
};

export default createServiceProxy({
  name: "Base",
  upstreamBaseUrl: () =>
    process.env.BASE_DASHBOARD_URL ??
    process.env.BASE_API_URL ??
    "https://base.hanzo.ai",
  mountPath: "/api/base",
  // Base (PocketBase) emits root-absolute paths: /_/assets/*, /_/favicon.svg,
  // and runtime API calls to /api/*. Re-point them at the proxy mount so the
  // embedded SPA loads fully through the same-origin SSO proxy.
  rewritePrefixes: ["/_/", "/api/"],
  // The Base admin root is `/_/`; Base 307-redirects `/_` → `/_/`. Next.js
  // (trailingSlash: false) strips the slash off the iframe `src` first, so
  // without this the two redirects ping-pong forever. Forcing `_` → `_/` on the
  // upstream request makes Base answer 200 directly. The iframe points at the
  // slash-less `/api/base/_`.
  forceTrailingSlashFor: ["_"],
});
