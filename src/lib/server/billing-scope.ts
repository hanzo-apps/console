/**
 * Pure billing-subject scoping for the `/billing/*` per-tenant proxy
 * (`app/v1/billing/[...path]/route.ts`). Extracted here (no Next imports) so the
 * tenant-isolation logic that prevents cross-tenant billing reads is unit-tested
 * directly, without standing up commerce or a full Next request — the same
 * pattern as `lib/server/ai-proxy.ts`.
 *
 * The threat: commerce filters DIFFERENT billing endpoints on DIFFERENT subject
 * params — subscriptions on `?userId=`, methods on `?customerId=` (or
 * `?user=`), usage on `?user=`. Pinning only ONE leaves the others UNFILTERED, so
 * a request with no (or a forged) param returns every subject's rows in the
 * namespace. The proxy therefore pins ALL of them to the server-resolved subject.
 */

/**
 * Every query param through which a commerce billing endpoint identifies its
 * subject. Kept identical to commerce's own edge-auth `billingSubjectKeys`
 * (commerce/middleware/edgeauth.go: {"user","userId","customerId"}). Change both
 * together — this is the contract that makes the proxy scope every endpoint.
 */
export const BILLING_SUBJECT_KEYS = ['user', 'userId', 'customerId'] as const

/** Orgs whose members bill per-USER (the shared catch-all). Mirrors commerce's PERSONAL_BILLING_ORGS. */
export function personalBillingOrgs(env: NodeJS.ProcessEnv = process.env): Set<string> {
  const raw = (env.PERSONAL_BILLING_ORGS || env.HANZO_DEFAULT_ORG || 'hanzo')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
  return new Set(raw)
}

/**
 * The commerce billing subject for an org+user — the SAME subject the gateway
 * debits. A member of a personal-billing org bills per-user as `<org>/<name>`; a
 * dedicated org bills per-org as `<org>`.
 */
export function billingSubject(org: string, name: string, env: NodeJS.ProcessEnv = process.env): string {
  const o = org.trim().toLowerCase()
  if (!o) return ''
  if (personalBillingOrgs(env).has(o)) {
    const n = name.trim().toLowerCase()
    return n ? `${o}/${n}` : o
  }
  return o
}

/**
 * The three holder classes a billing account binds to — the nodes of the scope tree
 * a debit walks. Kept identical to commerce's own vocabulary
 * (commerce/models/billingaccount/billingaccount.go `HolderUser`/`HolderOrg`/
 * `HolderProject`); a binding's `(holderKind, holderId)` is exactly what
 * `resolveBilling` collects (commerce/api/billing/resolve.go).
 */
export const HOLDER_KINDS = ['user', 'org', 'project'] as const
export type HolderKind = (typeof HOLDER_KINDS)[number]

/**
 * The `holderId` a binding write targets, DERIVED from the SERVER-RESOLVED identity
 * — never the browser's word. The browser names a holder KIND (and, for a project,
 * a project name); the server says WHICH holder that is, exactly as it already says
 * which billing subject the caller is (`billingSubject`):
 *   - `org`     → the caller's OWN org slug.
 *   - `user`    → the caller's OWN billing subject (the anchor `resolveBilling` collects).
 *   - `project` → the project NAME. Commerce reads it inside the caller's OWN org
 *     namespace (`ForHolder(db, …)` queries db's namespace, and `forwardBilling` pins
 *     `X-Org-Id` from the session), so a project label is tenant-confined by
 *     construction and two orgs with the same project name never collide.
 * An unknown kind → `null`: no holder is derivable, so the pin blanks `holderId`
 * rather than letting a client-supplied one through.
 */
export function holderIdFor(kind: string, org: string, subject: string, project: string): string | null {
  switch (kind) {
    case 'org':
      return org.trim().toLowerCase()
    case 'user':
      return subject
    case 'project':
      return project.trim()
    default:
      return null
  }
}

/**
 * Pin the HOLDER of a binding write onto the server-resolved identity, in place.
 *
 * A binding write (`POST /v1/billing/bindings`) is the one body that names a holder
 * — `{ holderKind, project?, accountId, priority }` — and the holder is WHO PAYS, so
 * a client-supplied `holderId` would be "bill this other user/org/project's chain
 * from an account I named". The browser therefore never sends `holderId`: this
 * derives it (`holderIdFor`) and OVERWRITES whatever arrived, mirroring how
 * `scopedBillingSearch` overwrites every subject param.
 *
 * A body with no `holderKind` is NOT a binding write and is left untouched — so the
 * live writes that legitimately carry a `project` (a spend-alert / budget, whose
 * scope IS a project name) pass through unchanged.
 */
function pinHolder(obj: Record<string, unknown>, org: string, subject: string): void {
  const kind = obj.holderKind
  if (typeof kind !== 'string' || !kind) return // not a binding write — untouched
  const project = typeof obj.project === 'string' ? obj.project : ''
  // An unknown kind derives no holder → blank it (commerce answers honestly on an
  // empty holder) rather than passing a client-supplied value through.
  obj.holderId = holderIdFor(kind, org, subject, project) ?? ''
  if (kind === 'project') delete obj.project // consumed INTO holderId — one fact, one field
}

/**
 * Rewrite a request's raw query string so it targets ONLY `subject`: pin every
 * `BILLING_SUBJECT_KEYS` param to `subject` (OVERWRITING any client-supplied
 * value — the browser cannot widen scope) and drop `org`. Non-subject params
 * (e.g. `status`, `type`, `currency`, `start`) pass through untouched.
 */
export function scopedBillingSearch(rawSearch: string, subject: string): string {
  const search = new URLSearchParams(rawSearch)
  for (const k of BILLING_SUBJECT_KEYS) search.set(k, subject)
  search.delete('org')
  return search.toString()
}

/**
 * Pin the billing subject onto a WRITE request body the SAME way `scopedBillingSearch`
 * pins the query — so a write (e.g. create a spend-alert / budget) is scoped to the
 * caller's OWN subject even when commerce reads the subject from the JSON body
 * (`CreateSpendAlert` binds `userId`), not the query. The proxy overwrites every
 * `BILLING_SUBJECT_KEYS` field on the top-level object with the server-resolved
 * `subject`, so:
 *   - the browser NEVER needs to know its billing subject (server-resolved), and
 *   - a client-forged `userId`/`user`/`customerId` in the body cannot widen scope
 *     (it is overwritten), mirroring the query defense.
 * A non-JSON or non-object body (or an empty body) is returned UNCHANGED — this only
 * ever narrows a JSON object to the caller; it never invents a body.
 *
 * Two ORTHOGONAL facts are pinned here, at this ONE seam — the body's SUBJECT (whose
 * ledger a write lands on) and, for a binding write, its HOLDER (whose chain an
 * account is attached to, `pinHolder`). `org` is the caller's server-resolved org,
 * needed to derive an `org`-kind holder (which is NOT the subject: a personal-billing
 * member's subject is `<org>/<user>`).
 */
export function scopedBillingBody(rawBody: string, subject: string, org: string): string {
  const body = rawBody.trim()
  if (!body) return rawBody
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return rawBody // not JSON (e.g. a form/binary write) — leave untouched
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return rawBody
  const obj = parsed as Record<string, unknown>
  for (const k of BILLING_SUBJECT_KEYS) obj[k] = subject
  pinHolder(obj, org, subject)
  return JSON.stringify(obj)
}
