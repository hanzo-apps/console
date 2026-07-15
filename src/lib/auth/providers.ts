/**
 * Live sign-in provider list for the embedded login.
 *
 * IAM owns which social providers an app can sign in with (get-app-login →
 * application.providers). ONE source of truth: the SignInForm renders its
 * social buttons from the app's REAL provider list — never a hardcoded set
 * that can drift from IAM (a button IAM can't honor strands the user on the
 * hanzo.id login with no matching option). If the read is empty or fails, no
 * social buttons render — social login goes through IAM, so when IAM can't be
 * read there is nothing a button could do anyway; email/password stays.
 */
import { config } from '~/config'
import { CALLBACK_PATH } from '~/lib/auth/iam'

export type SignInProvider = { name: string; type: string }

/**
 * Pure normalizer over the get-app-login payload: the app's sign-in-capable
 * providers as {name, type}, in IAM's order. Rows without a name/type or with
 * canSignIn !== true are dropped (IAM's own visibility flag is authoritative).
 */
export function signInProvidersOf(payload: unknown): SignInProvider[] {
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
  return out
}

/**
 * Fetch the app's live sign-in providers from IAM (CORS-open to the console
 * origin). Best-effort: any failure → [] → no social buttons render.
 */
export async function fetchSignInProviders(): Promise<SignInProvider[]> {
  if (typeof window === 'undefined') return []
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
    if (!res.ok) return []
    return signInProvidersOf(await res.json())
  } catch {
    return []
  }
}
