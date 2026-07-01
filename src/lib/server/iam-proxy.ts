/**
 * Shared IAM proxy forward — the ONE place a gated route forwards to Hanzo IAM.
 *
 * Both the GLOBAL admin proxy (`/admin/iam`) and the SELF-SERVICE org member proxy
 * (`/org/iam`) use this: they differ only in the GATE (who is admitted) and the
 * allow-list. Everything after — the allow-list check, TENANT SCOPING of every
 * owner the request references (query `owner`, `id`'s owner, AND the mutation
 * BODY's owner), the org-name guard for org-metadata reads, the org-admin
 * requirement for writes, forwarding as the user-bound bearer, and returning the
 * IAM envelope verbatim — lives here, so the policy is applied identically and the
 * cross-tenant write gap (IAM add/update/delete take the object in the BODY, not a
 * query param) is closed for BOTH proxies.
 */
import { type NextRequest, NextResponse } from 'next/server'

import { adminBearer, iamBaseUrl, type IamGate } from './identity'
import { ownerAllowed as policyOwnerAllowed, orgNameAllowed, orgWriteAllowed } from './admin-policy'

const forbidden = () => NextResponse.json({ error: 'forbidden' }, { status: 403 })
const notFound = () => NextResponse.json({ error: 'not found' }, { status: 404 })
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

/** The `<owner>` of an `<owner>/<name>` id, or the whole id when there's no slash. */
function idOwner(id: string | null): string | null {
  if (!id) return null
  const slash = id.indexOf('/')
  return slash > 0 ? id.slice(0, slash) : id
}

/** The `<name>` of an `<owner>/<name>` id, or the whole id when there's no slash. */
function idName(id: string | null): string | null {
  if (!id) return null
  const slash = id.indexOf('/')
  return slash > 0 ? id.slice(slash + 1) : id
}

/** A string `key` field of a JSON body, or null (best-effort — a mutation carries it). */
export function bodyField(text: string, key: string): string | null {
  if (!text) return null
  try {
    const j = JSON.parse(text) as Record<string, unknown>
    const v = j[key]
    return typeof v === 'string' ? v : null
  } catch {
    return null
  }
}

/**
 * The forwarded query string, PINNING `organization` to the caller's own scope when
 * the segment is org-keyed and the caller is NOT a global admin — so an omitted/empty
 * `organization` can't make IAM's lister return every org's rows (RED CRITICAL). A
 * global admin's value is left as-is (they may target any org, or all).
 */
export function pinnedSearch(rawSearch: string, orgKeyed: boolean, isGlobalAdmin: boolean, orgScope: string): string {
  const p = new URLSearchParams(rawSearch)
  if (orgKeyed && !isGlobalAdmin) p.set('organization', orgScope)
  const s = p.toString()
  return s ? `?${s}` : ''
}

export type IamForwardOpts = {
  /** `<owner>/<name>` path segment, e.g. `get-users`. */
  segment: string
  method: 'GET' | 'POST'
  /** Allow-list for this method — nothing else is reachable. */
  allowed: Set<string>
  /** Segments where the `admin` metadata owner is acceptable (org list/get). */
  orgMetaSegments: Set<string>
  /** Writes require org admin (the org proxy). The admin proxy gate is already
   *  global-only, so this is a no-op there. */
  requireAdminForWrite: boolean
  /** Segments carrying an org NAME to guard (get-organization) so a brand admin
   *  can't read another org's settings via the `admin` metadata owner. */
  orgNameSegments?: Set<string>
  /** Segments keyed by the `organization` param/body field (projects). For these a
   *  non-global admin's org is PINNED to their own scope — validating is not enough
   *  because an OMITTED/EMPTY organization makes IAM's lister drop its WHERE and
   *  return every org's rows (IAM bypasses Casbin for project routes → this proxy is
   *  the only gate). RED CRITICAL. */
  orgParamSegments?: Set<string>
}

/**
 * Enforce the policy for `gate`, then forward to IAM. Returns the IAM envelope
 * verbatim (status + content-type preserved), or a typed 403/404/502.
 */
export async function forwardIam(
  req: NextRequest,
  gate: IamGate,
  opts: IamForwardOpts,
): Promise<NextResponse> {
  const { segment, method, allowed } = opts
  if (!allowed.has(segment)) return notFound()

  // Writes: the org proxy requires an org admin (global admins always pass).
  if (method === 'POST' && opts.requireAdminForWrite && !orgWriteAllowed({ isGlobalAdmin: gate.isGlobalAdmin, isAdmin: gate.user.isAdmin })) {
    return forbidden()
  }

  const url = req.nextUrl
  const orgMetadataOk = opts.orgMetaSegments.has(segment)
  const ownerOk = (owner: string | null) =>
    policyOwnerAllowed(owner, { isGlobalAdmin: gate.isGlobalAdmin, orgScope: gate.orgScope, orgMetadataOk })

  // Every org the request references must be in scope: ?owner, the ?id owner, the
  // ?organization param (the projects lister keys on it), and — critically — for a
  // mutation the BODY owner + BODY organization (else a brand admin could POST
  // add-project/add-user with a body field = another tenant, which a query-only
  // check would miss). ownerOk(null) is true, so an absent field is a no-op.
  if (!ownerOk(url.searchParams.get('owner'))) return forbidden()
  if (!ownerOk(idOwner(url.searchParams.get('id')))) return forbidden()
  if (!ownerOk(url.searchParams.get('organization'))) return forbidden()

  // Org-metadata reads (get-organization id=admin/<name>): also pin the org NAME.
  if (opts.orgNameSegments?.has(segment) && !orgNameAllowed(idName(url.searchParams.get('id')), gate)) {
    return forbidden()
  }

  const orgKeyed = opts.orgParamSegments?.has(segment) ?? false

  let bodyText = ''
  if (method === 'POST') {
    bodyText = await req.text()
    if (!ownerOk(bodyField(bodyText, 'owner'))) return forbidden()
    if (!ownerOk(bodyField(bodyText, 'organization'))) return forbidden()
    // An org-keyed WRITE (add/delete-project) from a non-global admin MUST carry
    // their OWN org in owner+organization — ownerOk already blocks a FOREIGN org;
    // this also rejects an omitted/empty one (which would create an owner="" row
    // visible in the cross-tenant enumeration). RED.
    if (orgKeyed && !gate.isGlobalAdmin) {
      if (bodyField(bodyText, 'organization') !== gate.orgScope || bodyField(bodyText, 'owner') !== gate.orgScope) {
        return forbidden()
      }
    }
  }

  // Forwarded query with `organization` pinned to the caller's scope for an org-keyed
  // reader + non-global admin (server-authoritative, like X-Org-Id) — RED CRITICAL.
  const fwdSearch = pinnedSearch(url.search, orgKeyed, gate.isGlobalAdmin, gate.orgScope)

  let bearer: string
  try {
    bearer = await adminBearer(gate.user)
  } catch (e) {
    console.error('iam-proxy: could not mint user bearer:', msg(e))
    return NextResponse.json({ status: 'error', msg: 'Could not authorize the request.' }, { status: 502 })
  }

  const headers: Record<string, string> = { Authorization: `Bearer ${bearer}`, Accept: 'application/json' }
  const init: RequestInit = { method, headers, cache: 'no-store' }
  if (method === 'POST') {
    headers['Content-Type'] = 'application/json'
    init.body = bodyText
  }

  try {
    const res = await fetch(`${iamBaseUrl()}/v1/iam/${segment}${fwdSearch}`, init)
    const text = await res.text()
    return new NextResponse(text, {
      status: res.status,
      headers: { 'Content-Type': res.headers.get('content-type') ?? 'application/json' },
    })
  } catch (e) {
    console.error('iam-proxy: IAM unreachable:', msg(e))
    return NextResponse.json({ status: 'error', msg: 'Identity service is unavailable.' }, { status: 502 })
  }
}
