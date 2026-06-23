import { createServiceProxy, proxyApiConfig } from "@/src/server/service-proxy";

/**
 * Same-origin SSO proxy for the Hanzo Base admin dashboard.
 *
 * Forwards /api/base/* to ${BASE_DASHBOARD_URL}/_/* with session-derived tenant
 * headers injected. Loaded by the embedded Base dashboard iframe so the console
 * IAM session authenticates Base with no separate login.
 *
 * BASE_DASHBOARD_URL is server-only and never exposed to the client.
 */
export const config = proxyApiConfig;

export default createServiceProxy({
  name: "Base",
  upstreamBaseUrl: () =>
    process.env.BASE_DASHBOARD_URL ??
    process.env.BASE_API_URL ??
    "https://base.hanzo.ai",
  // Base's superuser admin UI is served under /_/.
  upstreamPrefix: "_",
  mountPath: "/api/base",
  // Base (PocketBase) emits root-absolute paths: /_/assets/*, /_/favicon.svg,
  // and runtime API calls to /api/*. Re-point them at the proxy mount so the
  // embedded SPA loads fully through the same-origin SSO proxy.
  rewritePrefixes: ["/_/", "/api/"],
});
