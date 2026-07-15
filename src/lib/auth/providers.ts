/**
 * Live sign-in provider list for the embedded login.
 *
 * IAM owns which social providers an app can sign in with (get-app-login →
 * application.providers). The SignInForm used to HARDCODE its social buttons,
 * which drifted from IAM: a "Continue with GitLab" button hinted
 * `provider-gitlab`, a provider the `hanzo-cloud` app does not have — IAM
 * could not auto-advance and stranded the user on the hanzo.id login page
 * with no GitLab option (the reported "redirects to hanzo.id, no social
 * options" dead-end). ONE source of truth: render buttons from the app's
 * REAL provider list; fall back to the known-good set only while loading or
 * if the read fails (never a button IAM can't honor — the fallback is the
 * set verified live to auto-advance).
 */
import { config } from '~/config'
import { CALLBACK_PATH } from '~/lib/auth/iam'

export type SignInProvider = { name: string; type: string }

/** The set proven live to auto-advance — used before/if the live read resolves. */
export const FALLBACK_PROVIDERS: SignInProvider[] = [
  { name: 'provider-github', type: 'GitHub' },
  { name: 'provider-google', type: 'Google' },
  { name: 'provider-web3', type: 'Web3Onboard' },
]

/**
 * Pure normalizer over the get-app-login payload: the app's sign-in-capable
 * providers as {name, type}. Returns null (→ caller keeps the fallback) when
 * the payload carries no usable provider — a broken/degraded IAM read must
 * never blank the social row.
 */
export function signInProvidersOf(payload: unknown): SignInProvider[] | null {
  const app = (payload as { data?: unknown } | null)?.data as
    | { providers?: unknown }
    | null
    | undefined
  const raw = Array.isArray(app?.providers) ? (app?.providers as unknown[]) : []
  const out: SignInProvider[] = []
  for (const item of raw) {
    const p = item as {
      name?: unknown
      canSignIn?: unknown
      provider?: { type?: unknown } | null
    }
    const name = typeof p?.name === 'string' ? p.name.trim() : ''
    const type = typeof p?.provider?.type === 'string' ? p.provider.type.trim() : ''
    if (!name || !type) continue
    if (p?.canSignIn !== true) continue
    out.push({ name, type })
  }
  return out.length > 0 ? out : null
}

/**
 * Fetch the app's live sign-in providers from IAM (CORS-open to the console
 * origin). Best-effort: any failure → null → the caller's fallback renders.
 */
export async function fetchSignInProviders(): Promise<SignInProvider[] | null> {
  if (typeof window === 'undefined') return null
  try {
    const redirect = `${window.location.origin}${CALLBACK_PATH}`
    const qs = new URLSearchParams({
      clientId: config.iamClientId,
      responseType: 'code',
      redirectUri: redirect,
      scope: 'openid profile email',
      state: 'app-login',
    })
    const res = await fetch(`${config.iamUrl}/v1/iam/get-app-login?${qs}`, {
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return null
    return signInProvidersOf(await res.json())
  } catch {
    return null
  }
}
