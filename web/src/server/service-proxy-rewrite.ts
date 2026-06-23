/**
 * Pure URL/body rewriting for the embed SSO proxy — decomplected from the
 * request-handling proxy (`service-proxy.ts`, which pulls in the session/env
 * chain) so the rewriting algorithm can be unit-tested in isolation with no
 * server imports.
 *
 * Embedded SPAs (Base/PocketBase, the Vite playground, …) emit root-absolute
 * paths like `/_/assets/x.js`, `/assets/x.js`, and runtime `/api/...` calls.
 * Those must be re-pointed at the same-origin proxy mount so they resolve
 * through the SSO proxy instead of 404ing against the console origin.
 */

/** Content types whose bodies we buffer + rewrite (text assets only). */
export function isRewritableContentType(ct: string | null): boolean {
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
export function rewriteBody(
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
 * Build the upstream path from the catch-all segments, re-adding a trailing
 * slash for configured SPA roots (see `forceTrailingSlashFor`). Pure so it can
 * be unit-tested without booting the handler.
 */
export function buildUpstreamPath(
  segments: string[],
  forceTrailingSlashFor: ReadonlySet<string>,
): string {
  const joined = segments.map(encodeURIComponent).join("/");
  if (joined && forceTrailingSlashFor.has(joined)) return `${joined}/`;
  return joined;
}
