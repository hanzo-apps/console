'use client'

/**
 * QR device-login wire (RFC 8628) — the console is the "device".
 *
 * Thin client over the console's OWN BFF (`/auth/device`): `start` asks IAM for a device
 * authorization (returns the QR target + user code + poll cadence), `poll` redeems the
 * once-approved code — on success the BFF has already set the sealed session cookies, so
 * the caller just reloads the session. Mirrors `iam-login.ts`: the BFF owns every IAM
 * secret and the token exchange; this module only speaks to the same-origin BFF.
 */

/** The console's OWN device-login route (same-origin BFF), not `/v1/*`. */
const DEVICE_URL = '/auth/device'

/** What `start` hands the UI to render the QR + drive polling. */
export type DeviceStart = {
  /** Opaque code the poll redeems (kept out of the QR — the QR carries the user URL). */
  deviceCode: string
  /** Short human code shown as text and prefilled in the scanned page. */
  userCode: string
  /** Bare approval page (display fallback when a phone can't scan). */
  verificationUri: string
  /** The QR target — the approval page with the user code prefilled. */
  verificationUriComplete: string
  /** Seconds until the codes lapse. */
  expiresIn: number
  /** Seconds between polls (RFC 8628 cadence from IAM). */
  interval: number
}

/** One poll outcome: keep waiting, the code lapsed, signed in, or a hard failure. */
export type DevicePoll =
  | { status: 'ok' }
  | { status: 'pending' }
  | { status: 'expired' }
  | { status: 'error'; message: string }

const jsonInit = (body: unknown): RequestInit => ({
  method: 'POST',
  credentials: 'include',
  headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
  cache: 'no-store',
  body: JSON.stringify(body),
})

/** Begin a QR device login. Throws on a hard failure (the UI surfaces a retry). */
export async function startDeviceLogin(): Promise<DeviceStart> {
  const res = await fetch(DEVICE_URL, jsonInit({ action: 'start' }))
  const j = (await res.json().catch(() => null)) as (Partial<DeviceStart> & { error?: string }) | null
  if (!res.ok || !j?.deviceCode || !j.userCode || !j.verificationUriComplete) {
    throw new Error(j?.error || `Could not start QR sign-in (HTTP ${res.status}).`)
  }
  return {
    deviceCode: j.deviceCode,
    userCode: j.userCode,
    verificationUri: j.verificationUri ?? '',
    verificationUriComplete: j.verificationUriComplete,
    expiresIn: typeof j.expiresIn === 'number' ? j.expiresIn : 0,
    interval: typeof j.interval === 'number' && j.interval > 0 ? j.interval : 5,
  }
}

/** Poll once for approval. A transient network error is reported as `pending` so the
 *  caller keeps polling; only a definitive BFF failure surfaces as `error`. */
export async function pollDeviceLogin(deviceCode: string): Promise<DevicePoll> {
  let res: Response
  try {
    res = await fetch(DEVICE_URL, jsonInit({ action: 'poll', deviceCode }))
  } catch {
    return { status: 'pending' }
  }
  const j = (await res.json().catch(() => null)) as { status?: string; error?: string } | null
  if (res.ok && (j?.status === 'ok' || j?.status === 'pending' || j?.status === 'expired')) {
    return { status: j.status }
  }
  return { status: 'error', message: j?.error || `Sign-in failed (HTTP ${res.status}).` }
}
