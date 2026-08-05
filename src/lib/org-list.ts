/**
 * Org-list decisions — the PURE core of the lazy-loading org switcher.
 *
 * No React, no I/O, no fabrication: it only ever transforms the orgs it is given
 * (or the query it is asked to page), so the switcher stays a thin render of this
 * and every branch is unit-tested.
 *
 * SCALE — the switcher is TRULY lazy: it fetches one page of `get-organizations`
 * at a time (`orgQuery`), appends via `mergeOrgs`, and loads more on demand
 * (infinite-scroll / "Load more") — never the whole tenant table up front. Search
 * is debounced and pushed to the server (`field`/`value` on the query) so a term
 * narrows the fetched set at the source; `visibleRows` ALSO client-filters the
 * loaded rows (over BOTH name and displayName) so what renders is always correct —
 * whether or not the backend honored the server filter.
 *
 * The pure helpers here are shared with the OrgSwitcher hook (which owns the fetch)
 * and reuse the org-picker's label/monogram helpers so there is ONE way to derive
 * an org's title, initials, and (honest, present-only) tier badge.
 */
import { filterOrgs } from '~/lib/org-scope'
import { orgTitle, initialsOf } from '~/components/org-picker/logic'
import type { Organization } from '~/lib/api'
import type { ListParams } from '~/lib/api/types'

/** Rows fetched per page — small for a snappy first paint; more load on demand. */
export const ORG_PAGE_SIZE = 20

/** Stable key for an org across pages (`owner/name`). */
export const orgKey = (o: Pick<Organization, 'owner' | 'name'>): string => `${o.owner}/${o.name}`

// ── Tier badge (Vercel-style Hobby / Pro / Enterprise) ───────────────────────
// Rendered ONLY when the org actually carries a plan/tier field — never invented.

export type TierTone = 'hobby' | 'pro' | 'enterprise'
export type OrgTier = { label: string; tone: TierTone }

const TIER_LABEL: Record<TierTone, string> = { hobby: 'Hobby', pro: 'Pro', enterprise: 'Enterprise' }

/** Map a raw plan string to a known tier, or null when it isn't one. */
function normTier(raw: unknown): TierTone | null {
  if (typeof raw !== 'string') return null
  const s = raw.trim().toLowerCase()
  if (!s) return null
  if (s === 'hobby' || s === 'free' || s === 'starter') return 'hobby'
  if (s === 'pro' || s === 'plus' || s === 'team' || s === 'growth') return 'pro'
  if (s === 'enterprise' || s === 'business' || s === 'scale') return 'enterprise'
  return null
}

/**
 * The org's plan/tier badge — read from a REAL field only. IAM orgs carry no tier
 * today, so this returns null (no badge) until a `tier`/`plan`/`tags` value flows;
 * it never fabricates a plan. Forward-compatible by construction.
 */
export function tierOf(org: Organization): OrgTier | null {
  const plan = org.plan as { name?: unknown } | string | undefined
  const candidates: unknown[] = [
    org.tier,
    typeof plan === 'string' ? plan : plan?.name,
    ...(Array.isArray(org.tags) ? org.tags : []),
  ]
  for (const c of candidates) {
    const t = normTier(c)
    if (t) return { label: TIER_LABEL[t], tone: t }
  }
  return null
}

// ── Paging ───────────────────────────────────────────────────────────────────

/**
 * The `get-organizations` query for page `page` (0-based) with an optional search
 * term. Pages are server-side (`p`/`pageSize`); a non-empty term is pushed to the
 * server as a `name` LIKE filter (`field`/`value`) so it narrows AT THE SOURCE and
 * scales to thousands of orgs. Sorted by name for a stable, resumable order.
 */
export function orgQuery(page: number, query: string, pageSize: number = ORG_PAGE_SIZE): ListParams {
  const q = query.trim()
  const params: ListParams = {
    owner: 'admin', // IAM orgs are owned by the reserved `admin` org
    page: page + 1, // the backend `p` is 1-based (listQuery maps page→p)
    pageSize,
    sortField: 'name',
    sortOrder: 'ascending',
  }
  if (q) {
    params.field = 'name'
    params.value = q
  }
  return params
}

/** Append a freshly-fetched page, deduped by `owner/name`, preserving order. */
export function mergeOrgs(existing: Organization[], incoming: Organization[]): Organization[] {
  const seen = new Set(existing.map(orgKey))
  const merged = existing.slice()
  for (const o of incoming) {
    const k = orgKey(o)
    if (!seen.has(k)) {
      seen.add(k)
      merged.push(o)
    }
  }
  return merged
}

/**
 * Whether more pages remain — a FULL page implies there may be more, a short
 * (or empty) page means we've reached the end. This needs no reliable total
 * count from the backend, so it's correct even when `data2` is absent.
 */
export function pageIsFull(lastCount: number, pageSize: number = ORG_PAGE_SIZE): boolean {
  return lastCount >= pageSize
}

// ── Render view-model ────────────────────────────────────────────────────────

/** A render-ready org row for the switcher. */
export type OrgRow = {
  /** Stable React key (`owner/name`). */
  key: string
  /** The org slug (identity — what `switchOrg` receives). */
  name: string
  /** Human label — displayName when set, else a title-cased slug. */
  title: string
  /** 1–2 letter monogram fallback when the org has no logo. */
  initials: string
  /** The org's own logo URL (IAM `logo`) when set, else ''. */
  logo: string
  /** Plan/tier badge, or null when the org carries no real tier. */
  tier: OrgTier | null
}

/** Build the render-ready view-model for one org (reuses the org-picker helpers). */
export function rowFor(org: Organization): OrgRow {
  return {
    key: orgKey(org),
    name: org.name,
    title: orgTitle(org),
    initials: initialsOf(org),
    logo: typeof org.logo === 'string' ? org.logo : '',
    tier: tierOf(org),
  }
}

/**
 * The rows to render for a query: client-filter the accumulated (server-paged)
 * rows over BOTH name and displayName, so the visible list is always correct even
 * if the backend ignored the `field`/`value` server filter, then map to row
 * view-models. One call → one source of truth for what the switcher shows.
 */
export function orgRows(orgs: Organization[], query: string): OrgRow[] {
  return filterOrgs(orgs, query).map(rowFor)
}
