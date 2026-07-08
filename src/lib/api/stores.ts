/**
 * Store admin API — the casibase `*-store(s)` surface on the cloud binary. These heads
 * REQUIRE a Bearer: a cookie-only `/v1/get-stores` 401s → a FALSE "session expired" for a
 * signed-in user. So every call goes through the console's OWN same-origin `/v1`
 * user-bearer BFF (`cloudGet`/`cloudPost` → the `app/v1/[...path]` catch-all), which mints
 * a short-lived user token; commerce/casibase scopes the org from the Bearer owner. The
 * heads are allow-listed in `proxy-allow.ts` (CLOUD_HEADS).
 */
import { cloudGet, cloudPost, idOf } from './client'
import { type Store } from './types'

export const StoreApi = {
  listGlobal: () => cloudGet<Store[]>('get-global-stores'),

  list: (owner: string) => cloudGet<Store[]>('get-stores', { owner }),

  get: (owner: string, name: string) => cloudGet<Store>('get-store', { id: idOf(owner, name) }),

  names: (owner: string) => cloudGet<string[]>('get-store-names', { owner }),

  update: (owner: string, name: string, store: Store) =>
    cloudPost('update-store', store, { id: idOf(owner, name) }),

  add: (store: Store) => cloudPost('add-store', store),

  remove: (store: Store) => cloudPost('delete-store', store),

  refreshVectors: (store: Store) => cloudPost('refresh-store-vectors', store),
}
