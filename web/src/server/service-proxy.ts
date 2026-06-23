import type { NextApiRequest, NextApiResponse } from "next";
import {
  applyProxyTenantHeaders,
  buildProxyTenantHeaders,
} from "@/src/server/tenant-headers";

/**
 * Shared catch-all reverse proxy for embedding a Hanzo app/service dashboard
 * inside console, authenticated by the IAM session.
 *
 * This is the ONE implementation behind every embedded service proxy
 * (Base, playground, …). It mirrors the hardened KMS proxy:
 *  - the upstream base URL is server-only (never exposed to the client);
 *  - client-supplied tenant headers are stripped (anti cross-tenant injection);
 *  - session-derived tenant headers (x-org-id / x-project-id / x-actor-id /
 *    x-env) are injected from the verified server session;
 *  - hop-by-hop headers are dropped; the response is streamed back.
 *
 * Because the iframe loads this route on console's OWN origin, the console
 * session cookie flows with every request, so the embedded app is authenticated
 * via SSO with no separate login.
 */

/** Standard Next.js API config required for streaming a proxy. */
export const proxyApiConfig = {
  api: {
    bodyParser: false,
    responseLimit: false,
  },
} as const;

const TIMEOUT_MS = 30_000;

/** Headers that must not be forwarded between hops (RFC 7230). */
const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
]);

/** Tenant headers are injected from the session, never trusted from the client. */
const TENANT_HEADERS = new Set([
  "x-org-id",
  "x-project-id",
  "x-tenant-id",
  "x-actor-id",
]);

function readBody(req: NextApiRequest): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export type ServiceProxyOptions = {
  /** Logical service name, used in log lines and error messages. */
  name: string;
  /** Resolve the upstream base URL (server-only). Return undefined if unset. */
  upstreamBaseUrl: () => string | undefined;
  /**
   * Optional static upstream prefix prepended to the proxied path (e.g. the
   * Base admin UI lives under `/_/`). Leading/trailing slashes are normalized.
   */
  upstreamPrefix?: string;
};

/**
 * Build a Next.js Pages-Router API handler that proxies `/api/<svc>/*` to the
 * configured upstream with SSO tenant headers injected.
 */
export function createServiceProxy(options: ServiceProxyOptions) {
  const prefix = options.upstreamPrefix
    ? `/${options.upstreamPrefix.replace(/^\/+|\/+$/g, "")}`
    : "";

  return async function handler(req: NextApiRequest, res: NextApiResponse) {
    const baseUrl = options.upstreamBaseUrl();
    if (!baseUrl) {
      return res.status(503).json({
        error: `Hanzo ${options.name} not configured`,
        message: `Upstream URL for ${options.name} is not set`,
      });
    }

    // Catch-all path segments. An empty path (iframe root) is valid.
    const pathSegments = req.query.path;
    const segments = Array.isArray(pathSegments)
      ? pathSegments
      : typeof pathSegments === "string"
        ? [pathSegments]
        : [];
    const upstreamPath = segments.map(encodeURIComponent).join("/");

    const query = { ...req.query };
    delete query.path;
    const qs = new URLSearchParams(query as Record<string, string>).toString();

    const targetUrl =
      `${baseUrl.replace(/\/+$/, "")}${prefix}` +
      `${upstreamPath ? `/${upstreamPath}` : "/"}${qs ? `?${qs}` : ""}`;

    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.headers)) {
      const lowerKey = key.toLowerCase();
      if (HOP_BY_HOP.has(lowerKey)) continue;
      if (TENANT_HEADERS.has(lowerKey)) continue;
      if (value === undefined) continue;
      headers[key] = Array.isArray(value) ? value.join(", ") : value;
    }

    applyProxyTenantHeaders(headers, await buildProxyTenantHeaders(req, res));

    let body: Buffer | undefined;
    if (req.method && !["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      body = await readBody(req);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const upstream = await fetch(targetUrl, {
        method: req.method,
        headers,
        body: body ? new Uint8Array(body) : undefined,
        signal: controller.signal,
        redirect: "manual",
      });

      clearTimeout(timer);
      res.status(upstream.status);

      upstream.headers.forEach((value, key) => {
        if (HOP_BY_HOP.has(key.toLowerCase())) return;
        res.setHeader(key, value);
      });

      if (upstream.body) {
        const reader = upstream.body.getReader();
        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(value);
          }
        } finally {
          reader.releaseLock();
        }
      }

      res.end();
    } catch (err) {
      clearTimeout(timer);

      if (err instanceof Error && err.name === "AbortError") {
        return res.status(504).json({
          error: "Gateway Timeout",
          message: `Hanzo ${options.name} did not respond within ${TIMEOUT_MS}ms`,
        });
      }

      const message =
        err instanceof Error ? err.message : "Unknown proxy error";
      console.error(`[${options.name}-proxy]`, message);
      return res.status(502).json({
        error: "Bad Gateway",
        message: `Failed to reach Hanzo ${options.name}: ${message}`,
      });
    }
  };
}
