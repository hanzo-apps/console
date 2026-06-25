/**
 * ZAP-native Provider API — the drop-in twin of `lib/api/providers.ts`.
 *
 * PROOF OF PATTERN: identical call surface and return types to the REST
 * `ProviderApi`, but every call goes over binary ZAP (`zapCall`) instead of
 * JSON-over-HTTP (`get`/`post`). A product module migrates from REST to
 * ZAP-native by swapping ONE import — `from '~/lib/api'` → `from '~/lib/zap'` —
 * with zero changes to the view components, because the method names and the
 * `{ id: 'owner/name' }` argument shape are preserved verbatim.
 *
 * The backend routes on the `method` string (e.g. `"get-global-providers"`),
 * which is exactly the casibase `/v1` endpoint name the REST client targets —
 * so the SAME Go handlers back both transports once cloud serves `/zap`.
 *
 * (See `client.ts` for the live-status caveat: this compiles today; it needs
 * the cloud `/zap` WS face online to round-trip.)
 */
import { type Provider, type ListParams, listQuery } from '~/lib/api'
import { idOf } from '~/lib/api/client'
import { zapCall } from './client'

export const ProviderApiZap = {
  /** Globally-shared providers (read-only catalog). */
  listGlobal: () => zapCall<Provider[]>('get-global-providers'),

  // Mirrors the REST `getList` contract exactly: returns { rows, total } so the
  // list views are a true drop-in. casibase get-providers returns the rows in
  // `data`; total falls back to the row count (the REST client does the same
  // when the data2 total is absent).
  list: async (params: ListParams & { store?: string } = {}) => {
    const rows = await zapCall<Provider[]>('get-providers', { ...listQuery(params), store: params.store })
    return { rows: rows ?? [], total: Array.isArray(rows) ? rows.length : 0 }
  },

  get: (owner: string, name: string) => zapCall<Provider>('get-provider', { id: idOf(owner, name) }),

  update: (owner: string, name: string, provider: Provider) =>
    zapCall<string>('update-provider', { id: idOf(owner, name), provider }),

  add: (provider: Provider) => zapCall<string>('add-provider', provider),

  remove: (provider: Provider) => zapCall<string>('delete-provider', provider),

  refreshMcpTools: (provider: Provider) => zapCall<string>('refresh-mcp-tools', provider),
}
