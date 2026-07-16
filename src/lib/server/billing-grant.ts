/**
 * Server-to-server WELCOME GRANT — the onboarding paywall fix on the WRITE path.
 *
 * A brand-new self-serve signup lands in its OWN personal org with a $0 balance and
 * 402s on the first chat. This grants the one-time $5 trial credit at signup, via the
 * DESIGNED trusted-service path: commerce's idempotent, tag-deduped
 * `POST /v1/billing/grant-starter`, authenticated with the COMMERCE SERVICE TOKEN the
 * console already holds (the same credential + base URL the per-tenant billing proxy
 * uses — DRY, `billing-proxy.ts`).
 *
 * Why NOT a user-bound bearer here: the fresh account lives in its own personal org,
 * which the confidential `hanzo-console` client (org `hanzo`) cannot resolve — an
 * `issue-user-token`/password-grant for it fails ("the user does not exist"). The
 * service-token path is exactly "a trusted service grants on signup" and needs no user
 * session. For the subject, a personal org's billing key IS the org slug
 * (commerce `BillingSubject` = org.Name), so `X-Org-Id` + `user=<orgSlug>` target it.
 *
 * BEST-EFFORT: never throws, never blocks signup. The grant is idempotent (tag-deduped
 * per subject), so a transient failure is harmless — the read-path self-heal
 * (`/v1/billing/me/welcome` on first authenticated load) re-lands it. Returns true only
 * when commerce accepted the call.
 */
import { commerceBaseUrl, commerceServiceToken } from './billing-proxy'
import { fetchWithTimeout } from './fetch-timeout'

/**
 * Best-effort $5 welcome/starter grant for a freshly created personal org. No-op
 * (returns false) when the commerce service token is unwired — the deployment then
 * relies purely on the read-path self-heal.
 */
export async function grantWelcomeCredit(orgSlug: string): Promise<boolean> {
  const token = commerceServiceToken()
  if (!token || !orgSlug) return false
  try {
    const res = await fetchWithTimeout(`${commerceBaseUrl()}/v1/billing/grant-starter`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'X-Org-Id': orgSlug,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      // Subject == the personal org slug; `trigger` tags the grant for the idempotency
      // dedupe + the audit trail.
      body: JSON.stringify({ user: orgSlug, trigger: 'console_signup' }),
      cache: 'no-store',
    })
    return res.ok
  } catch (e) {
    // Redact the exception (it carries the internal commerce host) — log server-side only.
    console.error('welcome-grant: grant-starter failed for', orgSlug, e instanceof Error ? e.message : String(e))
    return false
  }
}
