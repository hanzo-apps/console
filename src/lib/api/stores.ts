/**
 * Store admin API — the `/v1/ai/stores` resource on the cloud binary. These heads
 * REQUIRE a Bearer: a cookie-only call 401s → a FALSE "session expired" for a
 * signed-in user. So every call goes through the console's OWN same-origin `/v1`
 * user-bearer BFF (`cloudGet`/`cloudPost` → the `app/v1/[...path]` catch-all), which
 * mints a short-lived user token; the backend scopes the org from the Bearer owner.
 * The `ai` head is allow-listed in `proxy-allow.ts` (CLOUD_HEADS).
 */
import { cloudGet, cloudPost, cloudPatch, cloudDelete, memberOf } from './client'
import { type Store } from './types'

const STORES = 'ai/stores'

export const StoreApi = {
  listGlobal: () => cloudGet<Store[]>(`${STORES}/global`),

  list: (owner: string) => cloudGet<Store[]>(STORES, { owner }),

  get: (owner: string, name: string) => cloudGet<Store>(memberOf(STORES, owner, name)),

  names: (owner: string) => cloudGet<string[]>(`${STORES}/names`, { owner }),

  update: (owner: string, name: string, store: Store) =>
    cloudPatch(memberOf(STORES, owner, name), store),

  add: (store: Store) => cloudPost(STORES, store),

  remove: (store: Store) => cloudDelete(memberOf(STORES, store.owner, store.name)),

  refreshVectors: (store: Store) =>
    cloudPost(`${memberOf(STORES, store.owner, store.name)}/vectors`, store),
}
