/** Provider admin API — the `/v1/ai/providers` resource. */
import { get, getList, patch, post, del, memberOf } from './client'
import { type Provider, type ListParams, listQuery } from './types'

const PROVIDERS = 'ai/providers'

export const ProviderApi = {
  /** Globally-shared providers (read-only catalog). */
  listGlobal: () => get<Provider[]>(`${PROVIDERS}/global`),

  list: (params: ListParams & { store?: string } = {}) =>
    getList<Provider[]>(PROVIDERS, { ...listQuery(params), store: params.store }),

  get: (owner: string, name: string) => get<Provider>(memberOf(PROVIDERS, owner, name)),

  update: (owner: string, name: string, provider: Provider) =>
    patch(memberOf(PROVIDERS, owner, name), provider),

  add: (provider: Provider) => post(PROVIDERS, provider),

  remove: (provider: Provider) => del(memberOf(PROVIDERS, provider.owner, provider.name)),

  refreshMcpTools: (provider: Provider) => post(`${PROVIDERS}/mcp-tools`, provider),
}
