/**
 * Org onboarding — create the signed-in user's organization, server-side.
 *
 * Same-origin (`/onboard`): the browser sends only its first-party session
 * cookie; this handler resolves the user from that cookie and acts as the
 * confidential `hanzo-console` client (allowlisted for IAM_ORG_ADMIN_APPS +
 * IAM_USER_ADMIN_APPS). It creates a customer organization and makes the user
 * that org's admin (casdoor membership = the user's `owner`, so the cloud's
 * GetEffectiveOrg scopes everything to the new org once the user re-authenticates).
 *
 * Fail-closed + safe:
 *   - 401 with no session; 501 when the IAM client is unwired.
 *   - ONLY a zero-org user may onboard (an existing member would have to be MOVED
 *     out of their current org, orphaning its data) — anyone who already belongs
 *     to an org gets 409 and uses the OrgSwitcher instead.
 *   - reserved names (brand/staff + system orgs) are refused (pure policy).
 *
 *   POST /onboard { name }            → create + join org `slugify(name)`.
 *   POST /onboard { personal: true }  → create + join a personal `<username>` org.
 * Returns { org, displayName }; the client then re-auths so the new JWT carries
 * the new owner.
 */
import { type NextRequest, NextResponse } from 'next/server'

import {
  resolveAuthenticatedUser,
  mintConfigured,
  getOrganization,
  createOrganization,
  moveUserToOrg,
} from '~/lib/server/identity'
import {
  isReservedOrg,
  personalOrgSlug,
  slugifyOrg,
  validateOrgName,
  MAX_ORG_SLUG,
  MIN_ORG_SLUG,
} from '~/lib/server/onboarding'

export const runtime = 'nodejs'

/** Title-case the base of a username for a personal org's display name. */
function humanize(username: string): string {
  const base = (username.includes('@') ? username.slice(0, username.indexOf('@')) : username)
    .replace(/[._-]+/g, ' ')
    .trim()
  return base ? base.replace(/\b\w/g, (c) => c.toUpperCase()) : 'Personal'
}

/** First free slug at/after `base` (`base`, `base-2`, …); null if all taken. */
async function freeSlug(base: string): Promise<string | null> {
  for (let i = 1; i <= 20; i++) {
    const candidate = i === 1 ? base : `${base.slice(0, MAX_ORG_SLUG - 3)}-${i}`.replace(/-+/g, '-')
    if (candidate.length < MIN_ORG_SLUG || isReservedOrg(candidate)) continue
    if (!(await getOrganization(candidate))) return candidate
  }
  return null
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const user = await resolveAuthenticatedUser(req)
  if (!user) return NextResponse.json({ error: 'Sign in to create an organization.' }, { status: 401 })
  if (!mintConfigured()) {
    return NextResponse.json(
      { error: 'Organization creation is not configured on this deployment (IAM client unset).' },
      { status: 501 },
    )
  }

  // Zero-org only. A user who already belongs to an org would have to be MOVED
  // (orphaning their current org's data), so onboarding is refused for them.
  if (user.owner) {
    return NextResponse.json(
      { error: 'You already belong to an organization. Use the organization switcher to change scope.' },
      { status: 409 },
    )
  }

  const body = (await req.json().catch(() => ({}))) as { name?: string; personal?: boolean }
  const personal = body.personal === true

  let baseSlug: string
  let displayName: string
  if (personal) {
    baseSlug = personalOrgSlug(user.name) || slugifyOrg(user.email)
    if (!baseSlug || baseSlug.length < MIN_ORG_SLUG || isReservedOrg(baseSlug)) {
      baseSlug = `org-${slugifyOrg(user.name) || 'workspace'}`
    }
    displayName = humanize(user.name || user.email)
  } else {
    const v = validateOrgName(body.name ?? '')
    if (!v.ok) return NextResponse.json({ error: v.error }, { status: 400 })
    baseSlug = v.slug
    displayName = (body.name ?? '').trim()
  }

  // Personal orgs auto-suffix to stay unique; an explicit name that's taken is an
  // honest conflict the user resolves by choosing another.
  let slug = baseSlug
  if (await getOrganization(slug)) {
    if (!personal) {
      return NextResponse.json({ error: `“${slug}” is taken. Choose a different name.` }, { status: 409 })
    }
    const free = await freeSlug(baseSlug)
    if (!free) return NextResponse.json({ error: 'Could not find an available name.' }, { status: 409 })
    slug = free
  }

  try {
    await createOrganization({ name: slug, displayName, personal, sourceOwner: user.owner })
    await moveUserToOrg(user, slug)
  } catch (e) {
    return NextResponse.json(
      { error: `Could not create the organization: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 },
    )
  }

  return NextResponse.json({ org: slug, displayName })
}
