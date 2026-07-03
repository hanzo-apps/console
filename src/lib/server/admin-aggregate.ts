/**
 * Admin aggregate proxy policy — the PURE least-privilege surface for the
 * global-admin-gated `/v1/admin/*` reads AND writes, decomplected from the route
 * handler so the allow-list is one testable thing (mirrors `admin-policy.ts`).
 *
 * The route runs `getAdminGate` (global-admin only) FIRST, then forwards through
 * `forwardWithUserBearer` with this `allowAdminSurface` as the least-privilege gate.
 * Only the admin aggregate heads are reachable — NEVER `iam`/`kms` (those keep their
 * own gated proxies with their own tenant-scoping), so this can never become a
 * general cloud-api tunnel even if the rewrite were widened. The mutating heads
 * (`providers/toggle`, `providers/primary`) ride the SAME `getAdminGate` gate plus
 * the same-origin-CSRF hardening `forwardWithUserBearer` already enforces on any
 * non-GET method — no new trust boundary, one allow-list.
 */

/**
 * The admin aggregate heads the proxy forwards. All are cross-tenant GLOBAL-admin
 * surfaces gated identically by `getAdminGate`:
 *  - `overview`/`usage`/`orgs`/`audit`/`products` — the business/platform read board.
 *  - `finance` — the SaaS profitability read.
 *  - `compute` — the datastore fleets/bots/spend read.
 *  - `providers` — the platform-wide AI provider control board (GET the list; POST
 *    `providers/toggle` + `providers/primary` flip the shared-gateway routing). It
 *    is a HEAD like the others; `allowAdminSurface` admits `admin/providers[/...]`,
 *    so both the read and the two mutation sub-paths pass, and NOTHING else does.
 */
export const ADMIN_AGGREGATE_HEADS = ['overview', 'usage', 'orgs', 'audit', 'products', 'finance', 'compute', 'providers'] as const

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
