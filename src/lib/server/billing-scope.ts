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
