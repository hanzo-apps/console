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

/** The same-origin `/ai` proxy address for the connections head. */
const BASE = (): string => `${typeof window !== 'undefined' ? window.location.origin : ''}/ai/v1/ai/connections`

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
}
