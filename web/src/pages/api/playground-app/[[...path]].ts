import { createServiceProxy } from "@/src/server/service-proxy";

/**
 * Same-origin SSO proxy for the Hanzo Playground app dashboard.
 *
 * Forwards /api/playground-app/* to ${PLAYGROUND_APP_URL}/* with session-derived
 * tenant headers injected. Loaded by the embedded Playground dashboard iframe so
 * the console IAM session authenticates the playground with no separate login.
 *
 * PLAYGROUND_APP_URL is server-only and never exposed to the client.
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
  name: "Playground",
  upstreamBaseUrl: () =>
    process.env.PLAYGROUND_APP_URL ??
    process.env.NEXT_PUBLIC_PLAYGROUND_URL ??
    "http://hanzo-playground.hanzo.svc.cluster.local:8080",
  mountPath: "/api/playground-app",
  // The playground is a Vite SPA emitting root-absolute paths: /assets/*,
  // /favicon.svg, and runtime API calls to /api/*. Re-point them at the proxy
  // mount so the embedded SPA loads fully through the same-origin SSO proxy.
  rewritePrefixes: ["/assets/", "/favicon", "/api/"],
});
