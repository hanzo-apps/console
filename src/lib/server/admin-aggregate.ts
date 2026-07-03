/**
 * Admin aggregate proxy policy — the PURE least-privilege surface for the
 * global-admin-gated `/v1/admin/*` reads, decomplected from the route handler so
 * the allow-list is one testable thing (mirrors `admin-policy.ts`).
 *
 * The route runs `getAdminGate` (global-admin only) FIRST, then forwards through
 * `forwardWithUserBearer` with this `allowAdminSurface` as the least-privilege gate.
 * Only the admin READ heads are reachable — NEVER `iam`/`kms` (those keep their own
 * gated proxies with their own tenant-scoping), so this can never become a general
 * cloud-api tunnel even if the rewrite were widened.
 */

/** The admin READ heads the aggregate proxy forwards. */
export const ADMIN_AGGREGATE_HEADS = ['overview', 'usage', 'orgs', 'audit', 'products', 'finance', 'compute'] as const

const ALLOWED = new Set<string>(ADMIN_AGGREGATE_HEADS)

/**
 * True iff `path` is `admin/<allowed-head>[/...]` — the aggregate read surface.
 * Rejects `admin/iam`, `admin/kms`, a bare `admin`, and anything not under `admin/`.
 * The path is the post-normalization value `forwardWithUserBearer` re-validates
 * (traversal already rejected upstream), so this is a pure segment check.
 */
export function allowAdminSurface(path: string): boolean {
  const segs = path.replace(/^\/+/, '').replace(/\/+$/, '').split('/')
  return segs[0] === 'admin' && ALLOWED.has(segs[1] ?? '')
}
