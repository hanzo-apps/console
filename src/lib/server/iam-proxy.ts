/**
 * Shared IAM proxy forward — the ONE place a gated route forwards to Hanzo IAM.
 *
 * Both the SUPER admin proxy (`/admin/iam`) and the SELF-SERVICE org member proxy
 * (`/org/iam`) use this: they differ only in the GATE (who is admitted) and the
 * allow-list. Everything after — the allow-list check, TENANT SCOPING of every
 * owner the request references (query `owner`, AND the mutation BODY's owner,
 * including the one nested under `user`), the org-name guard for org-metadata
 * reads, the org-admin requirement for writes, forwarding as the user-bound
 * bearer, and returning IAM's answer verbatim — lives here, so the policy is
 * applied identically and the cross-tenant write gap (a write takes its target in
 * the BODY, not a query param) is closed for BOTH proxies.
 */
import { type NextRequest, NextResponse } from 'next/server'

import { adminBearer, iamBaseUrl, type IamGate } from './identity'
import { ownerAllowed as policyOwnerAllowed, orgNameAllowed, orgWriteAllowed } from './admin-policy'
import { csrfRefusal } from './bearer-proxy'
import { fetchWithTimeout } from './fetch-timeout'

const forbidden = () => NextResponse.json({ error: 'forbidden' }, { status: 403 })
const notFound = () => NextResponse.json({ error: 'not found' }, { status: 404 })
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))

/**
 * A string `key` of a JSON body — at the top level, or inside a nested `user`.
 *
 * The user is the ONE entity whose writes NEST: IAM takes the record under `user`,
 * beside a write-only password that is not a field on the record. Reading only the
 * top level would find no owner on exactly those two writes and wave them through,
 * so the nesting is followed here for the same reason IAM follows it in its own
 * AuthzTarget — the owner CHECKED has to be the owner WRITTEN.
 */
export function bodyField(text: string, key: string): string | null {
  if (!text) return null
  try {
    const j = JSON.parse(text) as Record<string, unknown>
    const top = j[key]
    if (typeof top === 'string') return top
    const user = j.user
    if (typeof user !== 'object' || user === null) return null
    const nested = (user as Record<string, unknown>)[key]
    return typeof nested === 'string' ? nested : null
  } catch {
    return null
  }
}

/**
 * The forwarded query string, PINNING `owner` to the caller's own scope when the
 * segment is org-keyed and the caller is NOT a SuperAdmin — so an omitted/empty
 * scope can't widen the listing. A SuperAdmin's value is left as-is (they may
 * target any org, or all).
 *
 * `owner` is the pin because `owner` is what IAM scopes a listing on. The pin used
 * to be on `organization`, which the project lister once keyed off; it reads the
 * owner now, so pinning the old name would leave the caller's scope unstated.
 */
export function pinnedSearch(rawSearch: string, orgKeyed: boolean, isSuperAdmin: boolean, orgScope: string): string {
  const p = new URLSearchParams(rawSearch)
  if (orgKeyed && !isSuperAdmin) p.set('owner', orgScope)
  const s = p.toString()
  return s ? `?${s}` : ''
}

export type IamForwardOpts = {
  /** The IAM route below `/v1/iam/`, e.g. `users` or `users/update`. */
  segment: string
  method: 'GET' | 'POST'
  /** Allow-list for this method — nothing else is reachable. */
  allowed: Set<string>
  /** Segments where the `admin` metadata owner is acceptable (org list/get). */
  orgMetaSegments: Set<string>
  /** Writes require org admin (the org proxy). The admin proxy gate is already
   *  SuperAdmin-only, so this is a no-op there. */
  requireAdminForWrite: boolean
  /** Routes carrying an org NAME to guard (`organizations/get`) so a brand admin
   *  can't read another org's settings via the `admin` metadata owner. */
  orgNameSegments?: Set<string>
  /** Org-keyed routes (projects). For these a non-SuperAdmin's `owner` is PINNED
   *  to their own scope — validating is not enough, because an OMITTED/EMPTY owner
   *  leaves the scope unstated and this proxy is the gate. RED CRITICAL. */
  orgParamSegments?: Set<string>
}

/**
 * Enforce the policy for `gate`, then forward to IAM. Returns IAM's answer
 * verbatim (status + content-type preserved), or a typed 403/404/502.
 */
export async function forwardIam(
  req: NextRequest,
  gate: IamGate,
  opts: IamForwardOpts,
): Promise<NextResponse> {
  const { segment, method, allowed } = opts

  // CSRF: this proxy authenticates from the first-party session cookie (auto-sent
  // cross-site), so a MUTATING IAM op (add/update/delete user, org settings, project)
  // must be same-origin. Fail closed BEFORE the allow-list, gate, or body read — a
  // cross-site POST can never mutate IAM on the victim's behalf. Safe reads pass.
  const csrf = csrfRefusal(req)
  if (csrf) return csrf

  if (!allowed.has(segment)) return notFound()

  // Writes: the org proxy requires an org admin (SuperAdmins always pass).
  if (method === 'POST' && opts.requireAdminForWrite && !orgWriteAllowed({ isSuperAdmin: gate.isSuperAdmin, isAdmin: gate.user.isAdmin })) {
    return forbidden()
  }

  const url = req.nextUrl
  const orgMetadataOk = opts.orgMetaSegments.has(segment)
  const ownerOk = (owner: string | null) =>
    policyOwnerAllowed(owner, { isSuperAdmin: gate.isSuperAdmin, orgScope: gate.orgScope, orgMetadataOk })

  // Every org the request references must be in scope: ?owner, the ?organization
  // param, and — critically — for a mutation the BODY owner + BODY organization
  // (else a brand admin could POST a project/user with a body field = another
  // tenant, which a query-only check would miss). ownerOk(null) is true, so an
  // absent field is a no-op.
  //
  // There is no `?id=<owner>/<name>` half to unpack any more: IAM addresses a
  // record by SEPARATE owner and name, so the owner is read where it is sent.
  if (!ownerOk(url.searchParams.get('owner'))) return forbidden()
  if (!ownerOk(url.searchParams.get('organization'))) return forbidden()

  // Org-metadata reads (organizations/get?owner=admin&name=<org>): also pin the
  // org NAME, which is the tenant — its owner is only the registry it lives in.
  if (opts.orgNameSegments?.has(segment) && !orgNameAllowed(url.searchParams.get('name'), gate)) {
    return forbidden()
  }

  const orgKeyed = opts.orgParamSegments?.has(segment) ?? false

  let bodyText = ''
  if (method === 'POST') {
    bodyText = await req.text()
    if (!ownerOk(bodyField(bodyText, 'owner'))) return forbidden()
    if (!ownerOk(bodyField(bodyText, 'organization'))) return forbidden()
    // Org-metadata WRITE (organizations/update): the record's own `name` field is
    // the tenant, and it must be in scope so a non-global admin can't retarget or
    // rename another tenant's org through the body. (No-op when absent.)
    if (opts.orgNameSegments?.has(segment) && !orgNameAllowed(bodyField(bodyText, 'name'), gate)) {
      return forbidden()
    }
    // An org-keyed WRITE (a project create/delete) from a non-SuperAdmin MUST carry
    // their OWN org as the owner — ownerOk already blocks a FOREIGN one; this also
    // rejects an omitted/empty owner, which would create an owner="" row visible in
    // the cross-tenant enumeration. `organization` is checked by ownerOk above and
    // is not required here: it is an indexed attribute of the record, while `owner`
    // is the key IAM scopes on, and a delete carries only the key.
    if (orgKeyed && !gate.isSuperAdmin && bodyField(bodyText, 'owner') !== gate.orgScope) {
      return forbidden()
    }
  }

  // Forwarded query with `organization` pinned to the caller's scope for an org-keyed
  // reader + non-SuperAdmin (server-authoritative, like X-Org-Id) — RED CRITICAL.
  const fwdSearch = pinnedSearch(url.search, orgKeyed, gate.isSuperAdmin, gate.orgScope)

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
    const res = await fetchWithTimeout(`${iamBaseUrl()}/v1/iam/${segment}${fwdSearch}`, init)
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
