import { createServiceProxy, proxyApiConfig } from "@/src/server/service-proxy";

/**
 * Same-origin SSO proxy for the Hanzo Playground app dashboard.
 *
 * Forwards /api/playground-app/* to ${PLAYGROUND_APP_URL}/* with session-derived
 * tenant headers injected. Loaded by the embedded Playground dashboard iframe so
 * the console IAM session authenticates the playground with no separate login.
 *
 * PLAYGROUND_APP_URL is server-only and never exposed to the client.
 */
export const config = proxyApiConfig;

export default createServiceProxy({
  name: "Playground",
  upstreamBaseUrl: () =>
    process.env.PLAYGROUND_APP_URL ??
    process.env.NEXT_PUBLIC_PLAYGROUND_URL ??
    "http://hanzo-playground.hanzo.svc.cluster.local",
});
