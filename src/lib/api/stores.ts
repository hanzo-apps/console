/** Store admin API — `/v1/*-store(s)`. Ported from StoreBackend.js. */
import { get, post, idOf } from './client'
import { type Store } from './types'

export const StoreApi = {
  listGlobal: () => get<Store[]>('get-global-stores'),

  list: (owner: string) => get<Store[]>('get-stores', { owner }),

  get: (owner: string, name: string) => get<Store>('get-store', { id: idOf(owner, name) }),

  names: (owner: string) => get<string[]>('get-store-names', { owner }),

  update: (owner: string, name: string, store: Store) =>
    post('update-store', store, { id: idOf(owner, name) }),

  add: (store: Store) => post('add-store', store),

  remove: (store: Store) => post('delete-store', store),

  refreshVectors: (store: Store) => post('refresh-store-vectors', store),
}
