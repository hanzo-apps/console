/**
 * AI Accounts client — the browser face of the same-origin `/ai-accounts/v1/*`
 * routes. The browser sends only its first-party session cookie; the route handler
 * resolves the user, seals/reads the credential server-side, and returns a MASKED
 * account list (existence + mode, never the secret) and the merged usage.
 *
 * Namespaced under `/ai-accounts/v1/` (like `/billing/v1/`) so the data plane never
 * shadows the UI tab URLs (`/ai-accounts`, `/ai-accounts/accounts`).
 */
import type { UsageSnapshot } from '@hanzo/usage'

import { restGet, restPost, restDelete } from './client'
import type { CloudUsageOverview } from './usage'
import type { ConnectMode } from '~/lib/products/ai-accounts'

const base = (): string => (typeof window !== 'undefined' ? window.location.origin : '')
const url = (p: string): string => `${base()}/ai-accounts/v1/${p.replace(/^\/+/, '')}`

/** Masked, secret-free account row. */
export type PublicAccount = { id: string; mode: ConnectMode; baseUrl?: string; connectedAt: string }
/** One provider's usage-engine outcome for the Overview cards. */
export type ProviderUsage = { id: string; ok: boolean; error?: string; usage?: UsageSnapshot }
/** The Overview payload: external-provider snapshots + the org's own Hanzo commerce lane. */
export type AccountsUsage = { providers: ProviderUsage[]; hanzo: CloudUsageOverview | null }

export const AiAccountsApi = {
  /** The masked list of connected accounts. */
  list: (): Promise<{ providers: PublicAccount[] }> => restGet(url('accounts')),
  /** Link (or re-link) a provider. `secret` is the API key / OAuth token / cookie header. */
  connect: (
    id: string,
    body: { mode: ConnectMode; secret: string; baseUrl?: string },
  ): Promise<{ providers: PublicAccount[] }> => restPost(url(`accounts/${id}`), body),
  /** Unlink a provider (its sealed secret is dropped). */
  disconnect: (id: string): Promise<void> => restDelete(url(`accounts/${id}`)),
  /** Unified usage across connected providers + the Hanzo lane. */
  usage: (): Promise<AccountsUsage> => restGet(url('usage')),
}
