/**
 * MfaApi — console-native TOTP (authenticator-app) two-factor enrollment.
 *
 * Talks to the console's own `/console/mfa/*` BFF (which forwards to Hanzo IAM as
 * the caller's user bearer, owner/name pinned server-side). The browser holds no
 * IAM credential and can only ever manage the signed-in user's OWN 2FA.
 *
 * Flow: initiate() → show the secret/otpauth URL to add to an authenticator →
 * verify(secret, code) → enable(secret, recoveryCode). disable() turns it off.
 */
import { ApiError } from './client'

/** What `initiate` returns — enough to add the account to an authenticator app. */
export type MfaSetup = {
  /** Base32 TOTP secret (manual entry). */
  secret: string
  /** `otpauth://totp/...` URI (QR / one-tap add). */
  url: string
  /** A one-time recovery code to store; required to enable. */
  recoveryCode: string
  /** Display hints from IAM (issuer = org, account = email/username). */
  accountName?: string
  issuer?: string
}

type Envelope<T> = { status?: string; msg?: string; data?: T }

async function mfaPost<T>(action: string, body: Record<string, string> = {}): Promise<T> {
  let res: Response
  try {
    res = await fetch(`/console/mfa/${action}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (e) {
    throw new ApiError(e instanceof Error ? e.message : 'Network request failed')
  }
  const json = (await res.json().catch(() => null)) as Envelope<T> | null
  if (!res.ok || !json || json.status !== 'ok') {
    throw new ApiError(json?.msg || `Request failed (HTTP ${res.status})`, res.status)
  }
  return (json.data ?? ({} as T))
}

/** Raw mfaProps IAM returns from initiate (only the fields we read). */
type InitiateData = {
  secret?: string
  url?: string
  recoveryCodes?: string[]
  accountName?: string
  issuer?: string
}

export const MfaApi = {
  /** Begin TOTP enrollment — returns the secret + otpauth URL + a recovery code. */
  initiate: async (): Promise<MfaSetup> => {
    const d = await mfaPost<InitiateData>('initiate')
    return {
      secret: d.secret ?? '',
      url: d.url ?? '',
      recoveryCode: Array.isArray(d.recoveryCodes) ? (d.recoveryCodes[0] ?? '') : '',
      accountName: d.accountName,
      issuer: d.issuer,
    }
  },

  /** Verify a passcode against the pending secret (does not enable yet). */
  verify: (secret: string, passcode: string): Promise<unknown> =>
    mfaPost('verify', { secret, passcode }),

  /** Persist TOTP as the user's two-factor (after a successful verify). */
  enable: (secret: string, recoveryCode: string): Promise<unknown> =>
    mfaPost('enable', { secret, recoveryCodes: recoveryCode }),

  /** Turn two-factor off for the signed-in user. */
  disable: (): Promise<unknown> => mfaPost('disable'),
}
