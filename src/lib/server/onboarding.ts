/**
 * Org-onboarding policy — PURE helpers, no Next/transport/IAM.
 *
 * Decomplected from the `/onboard` route (which does the IAM calls) so the
 * naming + reserved-name policy is one testable thing (mirrors admin-policy.ts).
 * Two concerns:
 *   - NAMING: turn a human org name (or a username) into a valid IAM org
 *     slug — lowercase, `[a-z0-9-]`, collapsed, trimmed, bounded.
 *   - RESERVED: refuse the names that must never become a customer org — the
 *     brand/staff orgs (hanzo/lux/zoo/pars) and IAM's system owners
 *     (admin/built-in/app). Creating one of these would either collide with the
 *     staff tenant (the OrgGate block) or a system principal.
 */

/** Brand/staff orgs + IAM system owners — never a customer org. */
export const RESERVED_ORGS: ReadonlySet<string> = new Set([
  // IAM system owners
  'admin',
  'built-in',
  'app',
  // brand/staff orgs (the OrgGate sends these to the admin host)
  'hanzo',
  'lux',
  'zoo',
  'pars',
])

/** Max slug length (IAM org name is varchar(100); keep it short + readable). */
export const MAX_ORG_SLUG = 60
/** Min slug length after normalization. */
export const MIN_ORG_SLUG = 2

/**
 * Normalize a human name to an IAM org slug: lowercase ASCII, non-alnum → `-`,
 * collapse repeats, trim leading/trailing `-`, cap at MAX_ORG_SLUG. Returns '' for
 * input that has no usable characters.
 */
export function slugifyOrg(input: string): string {
  return (input ?? '')
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_ORG_SLUG)
    .replace(/-+$/g, '') // a trailing '-' may reappear after the slice
}

/**
 * The default personal-org slug for a user. An email-like username collapses to
 * its local part (`dave@x.com` → `dave`) so a personal org reads as the person,
 * not their email address; everything else is slugified as-is.
 */
export function personalOrgSlug(username: string): string {
  const at = username.indexOf('@')
  const base = at > 0 ? username.slice(0, at) : username
  return slugifyOrg(base)
}

/** True when the slug is a brand/staff or system org — never creatable. */
export function isReservedOrg(slug: string): boolean {
  return RESERVED_ORGS.has(slug)
}

export type OrgNameResult = { ok: true; slug: string } | { ok: false; error: string }

/**
 * Validate + normalize a requested org name into a creatable slug, or an honest
 * error. The ONE place the create rules live (route + tests share it).
 */
export function validateOrgName(input: string): OrgNameResult {
  const slug = slugifyOrg(input)
  if (slug.length < MIN_ORG_SLUG) {
    return { ok: false, error: 'Use at least 2 letters or numbers.' }
  }
  if (isReservedOrg(slug)) {
    return { ok: false, error: `“${slug}” is reserved. Choose a different name.` }
  }
  return { ok: true, slug }
}
