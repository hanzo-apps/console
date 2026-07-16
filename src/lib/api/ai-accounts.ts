/**
 * AI Accounts client — the browser face of the same-origin `/v1/ai-accounts/*`
 * routes. The browser sends only its first-party session cookie; the route handler
 * resolves the user, seals/reads the credential server-side, and returns a MASKED
 * account list (existence + mode, never the secret) and the merged usage.
 *
 * Namespaced under `/v1/ai-accounts/` (like `/v1/billing/`) so the data plane never
 * shadows the UI tab URLs (`/ai-accounts`, `/ai-accounts/accounts`).
 */
import type { UsageSnapshot } from '@hanzo/usage'

import { restGet, restPost, restPut, restDelete } from './client'
import type { CloudUsageOverview } from './usage'
import type { ConnectMode, OrgRoutingDefaults } from '~/lib/products/ai-accounts'

const base = (): string => (typeof window !== 'undefined' ? window.location.origin : '')
const url = (p: string): string => `${base()}/v1/ai-accounts/${p.replace(/^\/+/, '')}`

/** Masked, secret-free account row. */
export type PublicAccount = { id: string; mode: ConnectMode; baseUrl?: string; connectedAt: string }
/** One provider's usage-engine outcome for the Overview cards. */
export type ProviderUsage = { id: string; ok: boolean; error?: string; usage?: UsageSnapshot }
/** The Overview payload: external-provider snapshots + the org's own Hanzo commerce lane. */
export type AccountsUsage = { providers: ProviderUsage[]; hanzo: CloudUsageOverview | null }
/** Non-secret org/user preferences — `routingEnabled` is the tri-state user override
 *  of the org smart-routing default: `true` on, `false` off, `null` follow org default. */
export type AiAccountsSettings = { routingEnabled: boolean | null }

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
  /** The org/user smart-routing preference. */
  settings: (): Promise<{ settings: AiAccountsSettings }> => restGet(url('settings')),
  /** Persist the smart-routing preference (an explicit on/off override). */
  saveSettings: (body: { routingEnabled: boolean }): Promise<{ settings: AiAccountsSettings }> =>
    restPut(url('settings'), body),
  /**
   * The server-driven org routing defaults (admin-set, via cloud-api). FAIL-SOFT: `null`
   * on any error — an older cloud-api that 404s the endpoint, a network failure, or a
   * malformed body — so the tab falls back to the cookie preference alone, exactly as
   * before this endpoint existed. Never throws.
   */
  routingDefaults: async (): Promise<OrgRoutingDefaults | null> => {
    try {
      const d = await restGet<{ auto_routing_active?: unknown; default_session_routing?: unknown }>(
        url('routing-defaults'),
      )
      return {
        autoRoutingActive: d?.auto_routing_active === true,
        defaultSessionRouting: d?.default_session_routing === true,
      }
    } catch {
      return null
    }
  },
}
