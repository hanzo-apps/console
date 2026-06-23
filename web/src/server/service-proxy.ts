import type { NextApiRequest, NextApiResponse } from "next";
import {
  applyProxyTenantHeaders,
  buildProxyTenantHeaders,
} from "@/src/server/tenant-headers";
import {
  rewriteBody,
  isRewritableContentType,
  buildUpstreamPath,
} from "@/src/server/service-proxy-rewrite";

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
   * Console-origin path this proxy is mounted at (e.g. `/api/base`). Required
   * when `rewritePrefixes` is set so root-absolute upstream URLs in HTML/JS/CSS
   * can be re-pointed at the proxy. Defaults to `/api/<name lowercased>`.
   */
  mountPath?: string;
  /**
   * Root-absolute upstream URL prefixes to rewrite into `<mountPath><prefix>` in
   * text responses (HTML/JS/CSS). Embedded SPAs (e.g. Base/PocketBase) emit
   * absolute paths like `/_/assets/...` and `/api/...` that would otherwise
   * resolve against the console origin and 404. Listing them here makes the
   * embed render fully through the same-origin SSO proxy. Order matters: list
   * the most specific prefixes first. Leave empty for plain pass-through.
   */
  rewritePrefixes?: string[];
  /**
   * Exact single-segment upstream paths that MUST keep a trailing slash on the
   * upstream request. Next.js (`trailingSlash: false`) 308-strips the trailing
   * slash off the iframe `src` before this handler runs, so a PocketBase-style
   * admin root that itself 307-redirects `/_` → `/_/` would otherwise ping-pong
   * forever (Next strips it, the upstream re-adds it). Listing the bare segment
   * here (e.g. `_`) makes the proxy request `<upstream>/_/` directly so the
   * upstream answers 200 and no redirect war occurs. The iframe must point at
   * the slash-less console path (e.g. `/api/base/_`).
   */
  forceTrailingSlashFor?: string[];
};

/**
 * Internal helpers exported for unit tests only. The pure rewriting logic now
 * lives in `service-proxy-rewrite.ts` (no server imports); re-exported here for
 * the existing `__test__` surface.
 */
export const __test__ = {
  rewriteBody,
  isRewritableContentType,
  buildUpstreamPath,
};

/**
 * Build a Next.js Pages-Router API handler that proxies `/api/<svc>/*` to the
 * configured upstream with SSO tenant headers injected.
 */
export function createServiceProxy(options: ServiceProxyOptions) {
  const mountPath = (
    options.mountPath ?? `/api/${options.name.toLowerCase()}`
  ).replace(/\/+$/, "");
  const rewritePrefixes = options.rewritePrefixes ?? [];
  const forceTrailingSlashFor = new Set(options.forceTrailingSlashFor ?? []);

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
    // Re-adds a trailing slash for configured SPA roots (e.g. Base's `/_/`) that
    // Next.js stripped, so the upstream answers 200 instead of 307-looping.
    const upstreamPath = buildUpstreamPath(segments, forceTrailingSlashFor);

    const query = { ...req.query };
    // Drop console-routing params so they don't leak into the upstream query:
    //  - `path`    : the Next.js catch-all segments (consumed above)
    //  - `service` : the `[service]` dynamic-route slug (registry lookup only)
    //  - `projectId`: the embed's tenant hint (conveyed via x-* headers, not URL)
    delete query.path;
    delete query.service;
    delete query.projectId;
    const qs = new URLSearchParams(query as Record<string, string>).toString();

    const targetUrl =
      `${baseUrl.replace(/\/+$/, "")}` +
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

      const contentType = upstream.headers.get("content-type");
      const shouldRewrite =
        rewritePrefixes.length > 0 && isRewritableContentType(contentType);

      // Rewrite Location on redirects so the SPA stays inside the proxy mount.
      const rewriteHeaderValue = (key: string, value: string): string => {
        if (rewritePrefixes.length > 0 && key.toLowerCase() === "location") {
          for (const p of rewritePrefixes) {
            if (value.startsWith(p)) return `${mountPath}${value}`;
          }
        }
        return value;
      };

      upstream.headers.forEach((value, key) => {
        const lower = key.toLowerCase();
        if (HOP_BY_HOP.has(lower)) return;
        // When rewriting the body, content-length changes — let Node set it.
        if (shouldRewrite && lower === "content-length") return;
        res.setHeader(key, rewriteHeaderValue(key, value));
      });

      if (upstream.body) {
        if (shouldRewrite) {
          // Buffer text assets, rewrite root-absolute upstream paths to the
          // proxy mount, then send. Binary/large assets keep streaming below.
          const buf = Buffer.from(await upstream.arrayBuffer());
          const rewritten = rewriteBody(
            buf.toString("utf8"),
            mountPath,
            rewritePrefixes,
          );
          res.setHeader(
            "content-length",
            Buffer.byteLength(rewritten).toString(),
          );
          res.write(rewritten);
        } else {
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
