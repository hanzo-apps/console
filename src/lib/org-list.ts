/**
 * Org-list decisions — the PURE core of the lazy-loading org/team switcher.
 *
 * No React, no I/O, no fabrication: it only ever transforms the orgs it is given
 * (or the query it is asked to page), so the switcher stays a thin render of this
 * and every branch is unit-tested.
 *
 * SCALE — the switcher is TRULY lazy: it fetches one page of the `organizations` registry
 * at a time (`orgQuery`), appends via `mergeOrgs`, and loads more on demand
 * (infinite-scroll / "Load more") — never the whole tenant table up front. Search
 * narrows the LOADED rows (`orgRows` → `filterOrgs`, over both name and
 * displayName): IAM's list takes an owner and a window and no filter, so there is
 * no term to push at it and nothing to reconcile a server answer against.
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
 * The organization-list query for page `page` (0-based). Pages are server-side
 * (`pageQuery` cuts them into `limit`/`offset`), which is what keeps the switcher
 * lazy over a large registry.
 *
 * The search term is NOT sent. IAM's list takes an owner and a window and nothing
 * else — no name filter, no sort key — so a term pushed at it would be ignored and
 * the caller would read a full page as a narrowed one. `orgRows` already narrows
 * what has loaded through `filterOrgs`, so search still works; what it no longer
 * does is narrow AT THE SOURCE. For a registry large enough that the match lives
 * past the loaded pages, the fix is a filter on IAM's list, not a parameter here
 * that nothing reads.
 *
 * Order is IAM's own (newest first) rather than by name — the list carries no sort
 * key either, and asking for one silently changes nothing.
 */
export function orgQuery(page: number, _query: string, pageSize: number = ORG_PAGE_SIZE): ListParams {
  return {
    owner: 'admin', // IAM orgs are owned by the reserved `admin` org
    page: page + 1, // 1-based, matching listQuery's `p`; page 0 is offset 0
    pageSize,
  }
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
 * count from the backend, so it's correct even when none is reported.
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
 * The rows to render for a query: filter the accumulated (server-paged) rows over
 * BOTH name and displayName, then map to row view-models. This is where search
 * HAPPENS — IAM's list carries no filter — so it is the one source of truth for
 * what the switcher shows.
 */
export function orgRows(orgs: Organization[], query: string): OrgRow[] {
  return filterOrgs(orgs, query).map(rowFor)
}
