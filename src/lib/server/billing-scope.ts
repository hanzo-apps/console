/**
 * Pure billing-subject scoping for the `/billing/*` per-tenant proxy
 * (`app/billing/[...path]/route.ts`). Extracted here (no Next imports) so the
 * tenant-isolation logic that prevents cross-tenant billing reads is unit-tested
 * directly, without standing up commerce or a full Next request — the same
 * pattern as `lib/server/ai-proxy.ts`.
 *
 * The threat: commerce filters DIFFERENT billing endpoints on DIFFERENT subject
 * params — subscriptions on `?userId=`, payment-methods on `?customerId=` (or
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
 */
export function scopedBillingBody(rawBody: string, subject: string): string {
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
  return JSON.stringify(obj)
}
