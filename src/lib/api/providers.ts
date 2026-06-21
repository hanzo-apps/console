/** Provider admin API — `/v1/*-provider(s)`. Ported from ProviderBackend.js. */
import { get, getList, post, idOf } from './client'
import { type Provider, type ListParams, listQuery } from './types'

export const ProviderApi = {
  /** Globally-shared providers (read-only catalog). */
  listGlobal: () => get<Provider[]>('get-global-providers'),

  list: (params: ListParams & { store?: string } = {}) =>
    getList<Provider[]>('get-providers', { ...listQuery(params), store: params.store }),

  get: (owner: string, name: string) => get<Provider>('get-provider', { id: idOf(owner, name) }),

  update: (owner: string, name: string, provider: Provider) =>
    post('update-provider', provider, { id: idOf(owner, name) }),

  add: (provider: Provider) => post('add-provider', provider),

  remove: (provider: Provider) => post('delete-provider', provider),

  refreshMcpTools: (provider: Provider) => post('refresh-mcp-tools', provider),
}
