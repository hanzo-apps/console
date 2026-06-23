import type { NextApiRequest, NextApiResponse } from "next";
import { createServiceProxy } from "@/src/server/service-proxy";
import {
  getEmbeddedService,
  serviceMountPath,
} from "@/src/features/embedded-services/registry";

/**
 * The ONE same-origin SSO proxy for EVERY embedded service.
 *
 * `/api/svc/<slug>/*` is resolved against the embedded-service registry and
 * forwarded to that service's upstream with session-derived tenant headers
 * injected (x-org-id / x-project-id / x-actor-id / x-env) — see
 * `createServiceProxy` + `tenant-headers`. This replaces the per-service proxy
 * files (api/base, api/playground-app): a new service is one registry entry,
 * not a new route.
 *
 * Upstream URLs are server-only (resolved from env inside the registry) and are
 * never exposed to the client. An unknown or unconfigured slug yields 404/503.
 */
// Next.js requires the page `config` export to be a statically analyzable
// object literal.
export const config = {
  api: {
    bodyParser: false,
    responseLimit: false,
  },
};

// Memoize one handler per slug: the proxy config (mountPath/rewritePrefixes/…)
// is process-stable per service, so build it once and reuse across requests.
const handlerCache = new Map<
  string,
  (req: NextApiRequest, res: NextApiResponse) => Promise<void> | void
>();

function handlerForSlug(slug: string) {
  const cached = handlerCache.get(slug);
  if (cached) return cached;
  const def = getEmbeddedService(slug);
  if (!def) return undefined;
  const handler = createServiceProxy({
    name: def.title,
    upstreamBaseUrl: def.upstreamBaseUrl,
    mountPath: serviceMountPath(def.slug),
    rewritePrefixes: def.rewritePrefixes,
    forceTrailingSlashFor: def.forceTrailingSlashFor,
  });
  handlerCache.set(slug, handler);
  return handler;
}

export default function handler(req: NextApiRequest, res: NextApiResponse) {
  const slug = Array.isArray(req.query.service)
    ? req.query.service[0]
    : req.query.service;
  const handle = slug ? handlerForSlug(slug) : undefined;
  if (!handle) {
    return res.status(404).json({
      error: "Unknown service",
      message: `No embedded service registered for "${slug ?? ""}"`,
    });
  }
  return handle(req, res);
}
