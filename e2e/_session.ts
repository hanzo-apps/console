/**
 * Session priming for render specs — the ONE recipe for the IAM-PKCE auth model.
 *
 * Identity is a client-held @hanzo/iam token now (there is NO /auth/session
 * endpoint): `AccountApi.session()` reads the sessionStorage access token and
 * projects the OIDC userinfo claims. So a spec authenticates by (1) seeding a
 * forged unsigned JWT + expiry into sessionStorage (the client only
 * base64-decodes the payload — no signature check in the browser), and
 * (2) serving the claims from a mocked userinfo endpoint (discovery is left to
 * 404 — the SDK synthesizes its endpoints). Registered AFTER a spec's own
 * catch-all route, these handlers win (Playwright matches routes in reverse
 * registration order), so legacy `/auth/session` mock branches are simply dead.
 *
 * Also seeds the first-run gates that otherwise block interaction: the guided
 * TOUR overlays the whole page at z=100000 (clicks hang on actionability), the
 * onboarding wizard is a takeover, and Scope parks on the picker.
 *
 * Usage (after the spec registers its own catch-all page.route):
 *   await primeSession(page)                       // hanzo/z admin (default)
 *   await primeSession(page, { owner: 'maxpower', name: 'dave', isAdmin: false })
 */
import type { Page, Route } from '@playwright/test'

export type SessionClaims = {
  owner: string
  name: string
  email?: string
  displayName?: string
  isAdmin?: boolean
  /** The IAM user's property bag — where `hanzo.preferences` rides as a SNAPSHOT. */
  properties?: Record<string, string>
  /** When the token was minted (`iat`, seconds). Defaults to now; set it in the past
   *  to reproduce the production case where the snapshot predates a later write. */
  issuedAt?: number
}

/**
 * base64URL — what a JWT segment actually is. Plain base64 was close enough while the
 * payloads were tiny, but `+` and `/` appear as soon as one grows (a `properties` bag
 * is enough), and a strict decoder rejects the token outright: the SDK reports signed
 * out and the app sits on its loader forever.
 */
const b64 = (o: object): string =>
  Buffer.from(JSON.stringify(o)).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/** The default identity render specs run as — a hanzo-org admin. */
export const DEFAULT_CLAIMS: Required<Omit<SessionClaims, 'properties' | 'issuedAt'>> = {
  owner: 'hanzo',
  name: 'z',
  email: 'z@hanzo.ai',
  displayName: 'Z Admin',
  isAdmin: true,
}

/** An unsigned JWT whose payload carries the claims, an `iat` and a far-future `exp`. */
export function forgeToken(claims: SessionClaims): string {
  const iat = claims.issuedAt ?? Math.floor(Date.now() / 1000)
  const payload = { ...claims, sub: `${claims.owner}/${claims.name}`, iat, exp: iat + 86_400 }
  return `${b64({ alg: 'none' })}.${b64(payload)}.x`
}

/** Seed tokens + gate keys and register the IAM endpoint mocks. */
export async function primeSession(page: Page, overrides: Partial<SessionClaims> = {}): Promise<void> {
  const claims: SessionClaims = { ...DEFAULT_CLAIMS, ...overrides }
  await page.addInitScript(
    ({ org, token }: { org: string; token: string }) => {
      try {
        // localStorage, not sessionStorage: the `@hanzo/iam` token store is shared
        // across tabs (that IS the session), so seeding a per-tab area would leave
        // the SDK reading an empty store and every primed spec signed out.
        localStorage.setItem('hanzo_iam_access_token', token)
        localStorage.setItem('hanzo_iam_expires_at', String(Date.now() + 3600_000))
        localStorage.setItem('hanzo.console.org', org)
        localStorage.setItem('hanzo.console.org.selected', '1')
        localStorage.setItem(`hz_onboarding_done:${org}`, '1')
        localStorage.setItem(`hz_tour_seen:v1:${org}`, '1')
        localStorage.setItem('hz_admin_banner_dismissed', '1')
      } catch {
        /* private mode */
      }
    },
    { org: claims.owner, token: forgeToken(claims) },
  )
  // Registered after the spec's catch-all → these win for the IAM endpoints.
  await page.route('**/.well-known/**', (route: Route) => route.fulfill({ status: 404, body: '' }))
  await page.route('**/userinfo*', (route: Route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ...claims, sub: `${claims.owner}/${claims.name}` }),
    }),
  )
}
