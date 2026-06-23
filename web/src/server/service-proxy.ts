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
};

/** Internal helpers exported for unit tests only. */
export const __test__ = {
  get rewriteBody() {
    return rewriteBody;
  },
  get isRewritableContentType() {
    return isRewritableContentType;
  },
};

/** Content types whose bodies we buffer + rewrite (text assets only). */
function isRewritableContentType(ct: string | null): boolean {
  if (!ct) return false;
  const c = ct.toLowerCase();
  return (
    c.includes("text/html") ||
    c.includes("javascript") ||
    c.includes("text/css") ||
    c.includes("application/json")
  );
}

/**
 * Rewrite root-absolute upstream paths to be proxy-relative so an embedded SPA
 * loads its assets/API through the same-origin proxy mount. Rewrites quoted and
 * url()-wrapped occurrences of each prefix; idempotent (won't double-prefix).
 */
function rewriteBody(
  text: string,
  mountPath: string,
  prefixes: string[],
): string {
  if (prefixes.length === 0) return text;
  // Single combined pass: match a leading delimiter (quote / `(` / `=`)
  // followed by ANY of the prefixes, in ONE sweep, so freshly-inserted
  // `${mountPath}` text is never re-scanned (prevents cascading double-prefix
  // when mountPath itself begins with one of the prefixes, e.g. `/api/`).
  // Longest prefixes first so the alternation is greedy-correct.
  const ordered = [...prefixes].sort((a, b) => b.length - a.length);
  const alt = ordered
    .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const escapedMount = mountPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Negative lookahead on the mount path makes the rewrite idempotent: an
  // already-mounted occurrence (`="/api/base/_/..."`) is skipped because the
  // text after the delimiter starts with the mount path.
  const re = new RegExp(`(["'(=])(?!${escapedMount})(${alt})`, "g");
  return text.replace(re, (_m, lead: string, prefix: string) => {
    return `${lead}${mountPath}${prefix}`;
  });
}

/**
 * Build a Next.js Pages-Router API handler that proxies `/api/<svc>/*` to the
 * configured upstream with SSO tenant headers injected.
 */
export function createServiceProxy(options: ServiceProxyOptions) {
  const mountPath = (
    options.mountPath ?? `/api/${options.name.toLowerCase()}`
  ).replace(/\/+$/, "");
  const rewritePrefixes = options.rewritePrefixes ?? [];

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
