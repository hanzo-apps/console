/**
 * AI connections — the console face of the REAL, KMS-backed AI Login Manager
 * (`hanzoai/ai` `/v1/ai/connections`, ai#79/#80). A tenant links OpenAI, Anthropic,
 * or Google/Gemini by pasting an API key; the backend seals it to Hanzo KMS
 * (`StoreProviderSecret`, never plaintext, fail-closed) and thereafter serves that
 * provider for the org. This is the canonical BYO-keys path — the console CALLS it
 * rather than re-implementing key storage.
 *
 * Transport: the console's OWN keyless `/ai` proxy (`app/ai/[...path]`), which mints
 * a short-lived user-bound IAM bearer from the session and forwards to the gateway —
 * so the browser holds no key and the org is resolved server-side from the bearer.
 * The `v1/ai/connections` head is allow-listed in that route. Reads/writes are
 * secret-free: the backend returns only existence + a masked account label, never
 * the key or the `kms://` ref.
 */
import { ApiError, restGet, restPost } from './client'
import { normalizeProviderUsage, type ProviderUsage } from '@hanzo/usage'

export type { ProviderUsage } from '@hanzo/usage'

/** The providers the AI Login Manager can link (backend allow-list). */
export type AiConnectionProvider = 'openai' | 'anthropic' | 'google'

/** A masked, secret-free connection row. */
export interface AiConnection {
  provider: string
  connected: boolean
  /** `<org>/<name>` display label from the backend (never a key). */
  accountLabel?: string
  updatedAt?: string
}

/** The connectable providers with their display copy (order = preference). */
export const AI_CONNECTION_PROVIDERS: readonly { id: AiConnectionProvider; label: string; vendor: string; keyHint: string }[] = [
  { id: 'openai', label: 'OpenAI', vendor: 'ChatGPT · GPT', keyHint: 'sk-…' },
  { id: 'anthropic', label: 'Anthropic', vendor: 'Claude', keyHint: 'sk-ant-…' },
  { id: 'google', label: 'Google', vendor: 'Gemini', keyHint: 'AIza…' },
]

/**
 * The connections head address — the canonical `/v1/ai/connections` (the /v1-first law),
 * ONE form for BOTH deployments:
 *  - go:embed console (console.hanzo.ai): the cloud binary serves the connections API
 *    natively at `<origin>/v1/ai/connections` under the first-party session cookie
 *    (SanitizeIdentity).
 *  - Standalone (console2/admin): `next.config.mjs` dispatches the `ai` head to the narrow
 *    `/ai` user-bearer proxy, which mints a short-lived token and forwards to the gateway's
 *    `/v1/ai/connections` (org from the token owner).
 * ONE connect path either way — no key in the browser, org resolved server-side.
 */
const BASE = (): string => {
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  return `${origin}/v1/ai/connections`
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v ? v : undefined)

/** Normalize one backend row (snake_case tolerant) into an {@link AiConnection}. */
function normalizeOne(row: unknown): AiConnection {
  const r = (row && typeof row === 'object' ? row : {}) as Record<string, unknown>
  return {
    provider: str(r.provider) ?? '',
    connected: r.connected === true,
    accountLabel: str(r.account_label) ?? str(r.accountLabel),
    updatedAt: str(r.updated_at) ?? str(r.updatedAt),
  }
}

/** Normalize the list payload (bare array, or wrapped under a common key). */
function normalizeList(payload: unknown): AiConnection[] {
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as { connections?: unknown })?.connections)
      ? (payload as { connections: unknown[] }).connections
      : Array.isArray((payload as { data?: unknown })?.data)
        ? (payload as { data: unknown[] }).data
        : []
  return rows.map(normalizeOne).filter((c) => c.provider)
}

export const AiConnectionsApi = {
  /** List the org's connectable providers + which are connected (masked). */
  list: async (): Promise<AiConnection[]> => normalizeList(await restGet(BASE())),

  /**
   * Begin a provider-login OAuth (ai#85). Fetches the backend authorize URL
   * (`GET .../connections/<provider>/authorize?format=json` → `{ authorizeUrl }`)
   * so the caller can redirect the browser to the provider's consent screen; the
   * OAuth code exchange + KMS-sealing happens server-side in the backend callback.
   * Throws an `ApiError` with `status === 503` when the provider's OAuth app creds
   * aren't provisioned on this deployment — the caller shows an honest
   * "not available" state (provisioning is a separate ops step).
   */
  authorizeUrl: async (provider: AiConnectionProvider): Promise<string> => {
    const raw = await restGet<Record<string, unknown>>(`${BASE()}/${provider}/authorize?format=json`)
    const authorizeUrl = str(raw?.authorizeUrl) ?? str(raw?.authorize_url) ?? str(raw?.url)
    if (!authorizeUrl) throw new ApiError('The server did not return an authorize URL.')
    return authorizeUrl
  },

  /**
   * Link (or re-link) a provider with a raw API key. The key is POSTed to OUR proxy
   * over HTTPS and sealed to KMS server-side — never persisted in the browser, never
   * echoed back. Returns the masked connection row.
   */
  connect: async (provider: AiConnectionProvider, apiKey: string): Promise<AiConnection> =>
    normalizeOne(await restPost(BASE(), { provider, apiKey })),

  /**
   * Unlink a provider (the org reverts to Hanzo-served; the sealed secret is
   * tombstoned server-side). The AI router accepts POST for the delete, so this
   * rides the proxy's POST handler (no separate DELETE verb needed).
   */
  disconnect: (provider: AiConnectionProvider): Promise<unknown> => restPost(`${BASE()}/${provider}`),

  /**
   * Import a connected provider's usage (spend/tokens/requests/per-model/day-series).
   * The org's key is UNSEALED server-side (`GET /v1/ai/connections/:provider/usage`) and
   * NEVER touches the browser; this reads the normalized `ProviderUsage` value. Honest by
   * construction: a not-connected / scope-denied / empty provider returns a 200 with
   * connected/available flags + a human note — never a fabricated figure. Envelope-tolerant
   * (unwraps `{status,msg,data}` or a bare value) so it works over both transports.
   */
  usage: async (provider: string, from?: string, to?: string): Promise<ProviderUsage> => {
    const q = new URLSearchParams()
    if (from) q.set('from', from)
    if (to) q.set('to', to)
    const query = q.toString()
    const raw = await restGet<Record<string, unknown>>(`${BASE()}/${encodeURIComponent(provider)}/usage${query ? `?${query}` : ''}`)
    const payload = raw && typeof raw === 'object' && 'data' in raw ? (raw as { data: unknown }).data : raw
    return normalizeProviderUsage(payload, provider)
  },

  /**
   * List the org's CONNECTED providers and import each one's usage in parallel — the data
   * the unified usage board renders beside native Hanzo usage. Per-provider isolation: one
   * provider's import failing yields an honest failed card for THAT provider, never blanking
   * the others. Returns `[]` when nothing is connected (the board shows its connect prompt).
   */
  listWithUsage: async (from?: string, to?: string): Promise<ProviderUsage[]> => {
    const connected = (await AiConnectionsApi.list()).filter((c) => c.connected)
    if (connected.length === 0) return []
    const settled = await Promise.allSettled(connected.map((c) => AiConnectionsApi.usage(c.provider, from, to)))
    return settled.map((r, i) =>
      r.status === 'fulfilled'
        ? r.value
        : normalizeProviderUsage({ provider: connected[i]!.provider, connected: true, available: false, note: 'Usage import failed — retry.' }, connected[i]!.provider),
    )
  },
}
