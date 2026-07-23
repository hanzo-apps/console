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
 *     staff tenant (the Scope block) or a system principal.
 */

/** Brand/staff orgs + IAM system owners — never a customer org. */
export const RESERVED_ORGS: ReadonlySet<string> = new Set([
  // IAM system owners
  'admin',
  'built-in',
  'app',
  // brand/staff orgs (the Scope sends these to the admin host)
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

// ── Email self-serve signup (HIP-0111) — PURE helpers ─────────────────────────
// The `/auth/signup` BFF creates a brand-new IAM user PLUS their own personal org
// (as admin) in one shot, then the client signs them in. IAM users always belong
// to an org (AddUser rejects owner==""), so a "create account, then onboard" split
// isn't possible against Casdoor — the org is minted here. These helpers are the
// pure naming/validation policy; the route owns the IAM calls + the crypto digest.

/** Minimum password length. Above the cloned org policy (AtLeast6), a safe floor. */
export const MIN_PASSWORD = 8
/** Pragmatic email shape check — a single `@`, a dot in the domain, no spaces. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export type SignupResult =
  | { ok: true; email: string; password: string }
  | { ok: false; error: string }

/**
 * Validate a self-serve signup. Normalizes the email (trim + lowercase) so the
 * per-email org slug + the stored account are deterministic. Password is length-
 * only here (IAM hashes it argon2id server-side); complexity is the org policy's.
 */
export function validateSignup(emailInput: string, password: string): SignupResult {
  const email = (emailInput ?? '').trim().toLowerCase()
  if (!EMAIL_RE.test(email)) return { ok: false, error: 'Enter a valid email address.' }
  if ((password ?? '').length < MIN_PASSWORD) {
    return { ok: false, error: `Use a password of at least ${MIN_PASSWORD} characters.` }
  }
  return { ok: true, email, password }
}

/**
 * A username for the new account — the slugified email local part. Casibase's
 * AddUser regenerates a random name on a collision and login is by email, so this
 * is only a readable default, never a uniqueness key.
 */
export function deriveUsername(email: string): string {
  return personalOrgSlug(email) || 'user'
}

/** A friendly display name for the account/org from an email ("dave@x.com" → "Dave"). */
export function displayNameFromEmail(email: string): string {
  const local = (email.includes('@') ? email.slice(0, email.indexOf('@')) : email)
    .replace(/[._-]+/g, ' ')
    .trim()
  return local ? local.replace(/\b\w/g, (c) => c.toUpperCase()) : 'Workspace'
}

/**
 * The signup's personal-org slug: the email local part + a short digest of the
 * FULL email. Two properties this buys us WITHOUT a global user-lookup endpoint
 * (which this IAM doesn't expose — email uniqueness is per-org):
 *   - DETERMINISTIC per email → a repeat signup with the same email resolves to
 *     the SAME slug, so `getOrganization(slug)` catches an existing account (409).
 *   - INJECTIVE across emails → two different emails (even same local part on
 *     different domains) get different slugs, so they never false-collide.
 * The digest suffix also guarantees the slug is never a reserved org name.
 * `digestHex` is a hex sha-256 of the normalized email, supplied by the route
 * (crypto stays at the edge; this stays pure + testable).
 */
export function personalOrgFromEmail(email: string, digestHex: string): string {
  const base = personalOrgSlug(email) || 'user'
  const suffix = (digestHex || '').slice(0, 8) || '0'
  // Leave room for `-` + 8 hex under the max, then trim any trailing `-`.
  return `${base.slice(0, MAX_ORG_SLUG - 9).replace(/-+$/g, '')}-${suffix}`
}
