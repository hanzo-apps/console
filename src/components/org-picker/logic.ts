/**
 * Org-picker decisions — the PURE core of the org-less landing (sort, filter,
 * paginate, and the per-card view-model). No React, no I/O, no fabrication: it
 * only ever transforms the orgs it is given, so the view stays a thin render of
 * this and every branch is unit-tested.
 *
 * The picker is deliberately CLIENT-paginated: it fetches the caller's visible
 * orgs once (a global admin sees all; a tenant sees their own single org) and
 * this module slices the sorted, filtered list into pages of {@link PAGE_SIZE}
 * with an honest "show N more" remainder.
 */
import { filterOrgs } from '~/lib/org-scope'
import type { Organization } from '~/lib/api'

/** How many org cards a page shows before "Show more". */
export const PAGE_SIZE = 24

/** A single honest quick-fact rendered on a card (only present when its source is). */
export type OrgFact = { label: string; value: string }

/** The render-ready view-model for one org card. */
export type OrgCard = {
  /** Stable React key (`owner/name`). */
  key: string
  /** The org slug (identity). */
  name: string
  /** Human label — displayName when set, else a title-cased slug. */
  title: string
  /** 1–2 letter monogram fallback when the org has no logo. */
  initials: string
  /** The org's own logo URL (IAM `logo`) when set, else ''. */
  logo: string
  /** The caller's honest role in this org (never fabricated). */
  role: string
  /** Honest quick facts derived only from present fields. */
  facts: OrgFact[]
}

/** Context that decides the caller's role, without inventing one. */
export type PickerContext = {
  /** The signed-in user's own org (`account.owner`). */
  ownOrg: string
  /** Whether the caller is a global (cross-tenant) admin. */
  isSuperAdmin: boolean
  /** Whether the caller is an admin of their OWN org (`account.isAdmin`). */
  callerIsAdmin: boolean
  /**
   * The caller's role in each org they hold a MEMBERSHIP in (`org -> role`),
   * which is the only place the truth lives once a person can see more than one
   * org. Optional so a caller that has not loaded memberships still renders.
   */
  roles?: Record<string, string>
}

/** The full picker view for a query + page — everything the UI renders. */
export type PickerView = {
  cards: OrgCard[]
  /** Total orgs matching the filter (before pagination). */
  total: number
  /** How many are currently shown. */
  shown: number
  /** Whether a "Show more" affordance is warranted. */
  hasMore: boolean
  /** How many remain hidden past the current page. */
  remaining: number
}

const titleCase = (s: string): string =>
  s ? s.replace(/[-_]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : s

/** Human label for an org — its displayName, else a title-cased slug. */
export function orgTitle(org: Organization): string {
  return org.displayName?.trim() || titleCase(org.name)
}

/** 1–2 letter monogram from an org's label (logo fallback). */
export function initialsOf(org: Organization): string {
  const label = (org.displayName?.trim() || org.name || '').trim()
  if (!label) return '?'
  const words = label.split(/[\s-_]+/).filter(Boolean)
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
  return label.slice(0, 2).toUpperCase()
}

/**
 * The caller's HONEST role in this org — derived from real context, never guessed:
 *   - super admin viewing another org → "Super admin" (masquerade access)
 *   - an org they hold a MEMBERSHIP in → that membership's role
 *   - the caller's own org             → "Admin" when they admin it, else "Member"
 *
 * The membership is consulted BEFORE the own-org fallback, because once a person
 * can see more than one org the fallback is a guess. It used to end with a
 * comment calling its own last branch unreachable — "a non-global-admin only
 * ever sees their own org" — and that stopped being true the moment the picker
 * started listing memberships: every joined org then rendered "Member",
 * including ones the person administers.
 */
export function roleFor(org: Organization, ctx: PickerContext): string {
  const isOwn = org.name === ctx.ownOrg
  if (ctx.isSuperAdmin && !isOwn) return 'Super admin'
  const membership = ctx.roles?.[org.name]
  if (membership) return titleCase(membership)
  if (isOwn) return ctx.callerIsAdmin ? 'Admin' : 'Member'
  // No membership row and not their own org: say the weaker thing rather than
  // invent authority the caller may not have.
  return ctx.isSuperAdmin ? 'Admin' : 'Member'
}

/** The date portion (YYYY-MM-DD) of an IAM timestamp, or '' if unparseable. */
function datePart(iso: string | undefined): string {
  if (!iso || typeof iso !== 'string') return ''
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(iso.trim())
  return m ? m[1] : ''
}

/** Honest quick facts — only fields that are actually present produce a fact. */
export function factsFor(org: Organization): OrgFact[] {
  const facts: OrgFact[] = []
  const created = datePart(org.createdTime)
  if (created) facts.push({ label: 'Created', value: created })
  if (typeof org.websiteUrl === 'string' && org.websiteUrl.trim()) {
    facts.push({ label: 'Website', value: org.websiteUrl.trim().replace(/^https?:\/\//, '') })
  }
  return facts
}

/** Build the render-ready view-model for one org. */
export function cardFor(org: Organization, ctx: PickerContext): OrgCard {
  return {
    key: `${org.owner}/${org.name}`,
    name: org.name,
    title: orgTitle(org),
    initials: initialsOf(org),
    logo: typeof org.logo === 'string' ? org.logo : '',
    role: roleFor(org, ctx),
    facts: factsFor(org),
  }
}

/** Alphabetical by label (case-insensitive), stable, non-mutating. */
export function sortOrgs(orgs: Organization[]): Organization[] {
  return [...orgs].sort((a, b) =>
    orgTitle(a).toLowerCase().localeCompare(orgTitle(b).toLowerCase()),
  )
}

/** Client-side page slice: the first `page` pages, plus the honest remainder. */
export function paginate<T>(items: T[], page: number): { visible: T[]; hasMore: boolean; remaining: number } {
  const count = Math.max(1, page) * PAGE_SIZE
  const visible = items.slice(0, count)
  const remaining = Math.max(0, items.length - visible.length)
  return { visible, hasMore: remaining > 0, remaining }
}

/**
 * THE picker decision: filter (literal substring, DRY with the switcher) → sort
 * (alphabetical) → paginate (client slice) → map to card view-models. One call,
 * one source of truth for what the landing renders.
 */
export function pickerView(
  orgs: Organization[],
  query: string,
  page: number,
  ctx: PickerContext,
): PickerView {
  const matched = sortOrgs(filterOrgs(orgs, query))
  const { visible, hasMore, remaining } = paginate(matched, page)
  return {
    cards: visible.map((o) => cardFor(o, ctx)),
    total: matched.length,
    shown: visible.length,
    hasMore,
    remaining,
  }
}
