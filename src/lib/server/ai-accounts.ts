/**
 * AI-account credential store (server-only).
 *
 * Each connected provider's secret is kept in a SEALED (AES-256-GCM), httpOnly,
 * Secure cookie scoped to the `/ai-accounts` routes — reusing the console session
 * seal (`session.ts`), so there is no new key to provision, the blob is unforgeable
 * (AEAD) and never readable by browser JS. The secret NEVER leaves the server: it is
 * decrypted only to build the usage-engine `ProviderSettings` for a server-side
 * `runPipeline`, and every read-back to the client is MASKED (existence + mode only,
 * never the value). Nothing here logs a secret.
 *
 * TODO(KMS): move credential-at-rest from the sealed cookie to KMS (kms.hanzo.ai),
 * keyed per (org, user, provider), so credentials survive a cookie clear and are
 * centrally revocable. The sealed cookie is the interim per-user store — the task's
 * sanctioned fallback: one user's creds, unforgeable, path-scoped.
 */
import { type NextRequest } from 'next/server'
import { providerRegistry, type ProviderDescriptor, type ProviderSettings, type ProviderSourceMode } from '@hanzo/usage'

import { seal, open, type CookieDirective } from './session'
import type { ConnectMode } from '~/lib/products/ai-accounts'

export const AI_ACCOUNTS_COOKIE = 'hz_ai_accounts'
/** The sibling NON-SECRET preferences blob (routing on/off, …) — same seal, same scope. */
export const AI_SETTINGS_COOKIE = 'hz_ai_settings'
/** Scope the sealed blob to the ai-accounts routes only (it never needs to ride /v1 or the BFF). */
const COOKIE_PATH = '/ai-accounts'
const MAX_AGE_S = 90 * 24 * 60 * 60

export type StoredCredential = {
  mode: ConnectMode
  /** The one secret for the mode: api→apiKey, oauth→token, web→cookieHeader. */
  secret: string
  baseUrl?: string
  /** ISO 8601 connect time. */
  connectedAt: string
}
export type AiAccountsStore = Record<string, StoredCredential>

/** Read + decrypt the caller's stored accounts (empty on absent/tamper — fail-closed). */
export function readAccounts(req: NextRequest): AiAccountsStore {
  return open<AiAccountsStore>(req.cookies.get(AI_ACCOUNTS_COOKIE)?.value) ?? {}
}

/** The Set-Cookie directive that persists the (re-sealed) store. */
export function accountsCookie(store: AiAccountsStore): CookieDirective {
  return {
    name: AI_ACCOUNTS_COOKIE,
    value: seal(store),
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: COOKIE_PATH,
    maxAge: MAX_AGE_S,
  }
}

/**
 * Non-secret org/user preferences for the AI-accounts product. Sealed like the
 * credential store (same AEAD, same `/ai-accounts` scope) — the seal is for
 * integrity/unforgeability, not confidentiality (there is no secret here). The one
 * preference today is `routingEnabled`, a tri-state user OVERRIDE of the org's
 * `model: "auto"` smart-routing default (which the Hanzo surfaces read): `true` =
 * forced on, `false` = forced off, `null` = never touched → follow the org default
 * (`GET /v1/ai/router/defaults`). "Never touched" is the ABSENT cookie, so the
 * toggle only ever WRITES a concrete boolean; `null` is a read-side default only.
 */
export type AiAccountsSettings = { routingEnabled: boolean | null }

const DEFAULT_SETTINGS: AiAccountsSettings = { routingEnabled: null }

/** Coerce an opened blob into settings — defensive. A strict boolean is an explicit
 *  override; anything else (absent/garbage) is `null` = follow the org default. */
export function normalizeSettings(raw: unknown): AiAccountsSettings {
  const r = (raw ?? {}) as Partial<AiAccountsSettings>
  return { routingEnabled: r.routingEnabled === true ? true : r.routingEnabled === false ? false : null }
}

/** Read + decrypt the caller's preferences (defaults to the unset override on
 *  absent/tamper — so a fresh user follows the org default). */
export function readSettings(req: NextRequest): AiAccountsSettings {
  const opened = open<AiAccountsSettings>(req.cookies.get(AI_SETTINGS_COOKIE)?.value)
  return opened ? normalizeSettings(opened) : DEFAULT_SETTINGS
}

/** The Set-Cookie directive that persists the (re-sealed) preferences. */
export function settingsCookie(settings: AiAccountsSettings): CookieDirective {
  return {
    name: AI_SETTINGS_COOKIE,
    value: seal(settings),
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: COOKIE_PATH,
    maxAge: MAX_AGE_S,
  }
}

/** MASKED public view of a stored credential — existence + mode, NEVER the secret. */
export type PublicAccount = { id: string; mode: ConnectMode; baseUrl?: string; connectedAt: string }
export function maskAccounts(store: AiAccountsStore): PublicAccount[] {
  return Object.entries(store).map(([id, c]) => ({
    id,
    mode: c.mode,
    baseUrl: c.baseUrl || undefined,
    connectedAt: c.connectedAt,
  }))
}

/** The usage-engine descriptor for a stored provider id (null when unknown). */
export function descriptorFor(id: string): ProviderDescriptor | null {
  return providerRegistry[id] ?? null
}

/**
 * Build the usage-engine settings from a stored credential — the secret lives only in
 * this in-memory object for the duration of one server-side fetch. `ConnectMode` is a
 * subset of `ProviderSourceMode`, so the mode carries straight through.
 */
export function settingsFor(c: StoredCredential): { mode: ProviderSourceMode; settings: ProviderSettings } {
  const settings: ProviderSettings = {}
  if (c.baseUrl) settings.baseUrl = c.baseUrl
  if (c.mode === 'api') settings.apiKey = c.secret
  else if (c.mode === 'web') settings.cookieHeader = c.secret
  else settings.getToken = async () => c.secret // oauth
  return { mode: c.mode, settings }
}
