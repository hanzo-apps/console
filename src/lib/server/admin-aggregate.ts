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
 *    is a HEAD like the others; `allowAdminSurface` admits `v1/admin/providers[/...]`,
 *    so both the read and the two mutation sub-paths pass, and NOTHING else does.
 *  - `promos` — the single platform plan promo (GET the current promo; PUT upserts it).
 *  - `spend-caps` — cross-tenant usage-cap oversight/override (GET the list for an org;
 *    POST creates; PATCH/DELETE `spend-caps/:id` edit/remove — all `?org=<slug>`-scoped).
 *    `allowAdminSurface` admits `v1/admin/spend-caps[/...]`, so the `:id` sub-path passes.
 */
export const ADMIN_AGGREGATE_HEADS = ['overview', 'usage', 'orgs', 'audit', 'products', 'finance', 'compute', 'o11y', 'providers', 'customers', 'revenue', 'analytics', 'enablement', 'grants', 'referrals', 'affiliates', 'authors', 'treasury', 'services', 'promos', 'spend-caps', 'storage'] as const

const ALLOWED = new Set<string>(ADMIN_AGGREGATE_HEADS)

/**
 * True iff `path` is `v1/admin/<allowed-head>[/...]` — the aggregate read (and the
 * `providers/{toggle,primary}` write) surface. The forwarded upstream path is
 * `v1/admin/<head>` because cloud serves every admin route under `/v1/admin/*` (the
 * `route.ts` handler rebuilds it, and `forwardWithUserBearer` forwards VERBATIM), so
 * this validates that exact shape — NOT the bare `admin/<head>` that never reaches a
 * real cloud route. Rejects `v1/admin/iam`, `v1/admin/kms` (their own tenant-scoped
 * proxies), a bare `v1/admin`, and anything not under `v1/admin/`.
 *
 * `forwardWithUserBearer` calls this on BOTH the raw path and the WHATWG-normalized
 * URL path (the exact string `fetch` will send), AFTER `pathIsClean` has already
 * rejected every dot-segment / encoded-slash / matrix-param traversal — so a
 * `v1/admin/providers/../iam` is refused at layer 1 (literal `..`) and its normalized
 * form `v1/admin/iam` is refused here (head `iam` ∉ ALLOWED). Segment-exact, pure.
 */
export function allowAdminSurface(path: string): boolean {
  const segs = path.replace(/^\/+/, '').replace(/\/+$/, '').split('/')
  return segs[0] === 'v1' && segs[1] === 'admin' && ALLOWED.has(segs[2] ?? '')
}
