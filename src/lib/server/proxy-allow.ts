/**
 * Least-privilege allow-lists for the same-origin user-bearer proxies (pure, tested).
 *
 * Each proxy mints a user-bound Bearer and forwards to a backend; the JWT owner
 * claim scopes tenancy server-side, so these lists are DEFENSE IN DEPTH — they keep
 * a proxy from becoming a general tunnel to everything the cloud-api or visor binary
 * mounts (e.g. `/cloud` must never reach `v1/iam/*` or admin endpoints).
 */

/**
 * Cloud-api `/v1/<head>` surfaces reachable through `/cloud` as the signed-in user.
 * These are exactly the data + serverless products whose backends authorize on the
 * Bearer owner claim (and 403 a cookie-only call): the seven managed data resources
 * plus the serverless / prompt / agent surfaces.
 */
export const CLOUD_HEADS: readonly string[] = [
  // Managed data resources (provisioning service) — one REST head per kind.
  'sql',
  'vector',
  'datastore',
  'kv',
  'search',
  's3',
  'docdb',
  // Serverless + prompt/agent/eval surfaces (org resolved from the Bearer owner claim).
  'functions',
  'prompts',
  'agents',
  // Evals facade (cloud clients/eval): /v1/evals/{scores,datasets,dataset-items,
  // evaluators,runs}. Single-segment sub-paths under the one `evals` head; the
  // facade resolves the console project key pair from the request tenant (the
  // Bearer owner), so routing it through /cloud gives correct per-org scoping —
  // the same reason it must NOT be a cookie-only same-origin call (that 403s).
  'evals',
]

/** The `<head>` of a `v1/<head>/...` path, or null when it isn't a `v1/` path. */
export function v1Head(path: string): string | null {
  const m = path.replace(/^\/+/, '').match(/^v1\/([^/?#]+)/)
  return m ? m[1] : null
}

/** True iff `path` (e.g. `v1/vector/mydb`) is an allow-listed cloud-api surface. */
export function allowCloudSurface(path: string): boolean {
  const head = v1Head(path)
  return head != null && CLOUD_HEADS.includes(head)
}

/**
 * True iff `path` targets the visor `/v1/*` surface (regions/gpus/machines/…). Visor
 * (vm.hanzo.ai) serves ONLY its own compute surface, so the whole `v1/` subtree is
 * the correct boundary — the task's `/vm` → visor `/v1/*` contract — while still
 * refusing any non-`v1` path.
 */
export function allowVisorSurface(path: string): boolean {
  const rel = path.replace(/^\/+/, '')
  return rel === 'v1' || rel.startsWith('v1/')
}

/**
 * Commerce `/v1/<head>` store surfaces reachable through `/commerce` as the signed-in
 * user. Commerce (`commerce.hanzo.svc`) serves the whole store admin over its REST
 * models, and EdgeAuth scopes every one to the Bearer owner's org — but this list is
 * defense in depth: it keeps the `/commerce` proxy from being a general tunnel to the
 * money/tenant-admin surfaces that share the same binary (`billing`, `checkout`,
 * `_/commerce/tenants`, `namespace`), which the console reaches through their OWN
 * scoped proxies (`/billing`) or not at all. Only the merchant catalog/order/customer
 * heads the store dashboard reads + writes are admitted (singular REST model names,
 * matching commerce's `rest.New(<kind>{})` routes).
 */
export const COMMERCE_HEADS: readonly string[] = [
  'product', // products
  'variant', // inventory / SKUs
  'collection', // catalog collections
  'order', // orders
  'user', // customers
  'discount', // promotions & discounts
  'coupon', // discount codes
  'saleschannel', // sales channels
  'stocklocation', // stock locations
  'store', // storefront settings
]

/** True iff `path` (e.g. `v1/product/abc`) is an allow-listed commerce store surface. */
export function allowCommerceSurface(path: string): boolean {
  const head = v1Head(path)
  return head != null && COMMERCE_HEADS.includes(head)
}

/** Matches exactly `v1/collections/<name>/records` and `.../records/<id>` (one clean
 *  segment each — `bearer-proxy` has already rejected empty/dot/encoded segments). */
const BASE_RECORDS = /^v1\/collections\/[^/]+\/records(?:\/[^/]+)?$/

/**
 * True iff `path` targets the Hanzo Base DATA PLANE reachable through `/superbase`
 * as the signed-in user: the collection schemas (`v1/collections`, read) and any
 * collection's records (`v1/collections/<name>/records[/<id>]` — list/get/create/
 * update/delete). Base authorizes each read/write per-user AND per-collection
 * itself (each collection's ListRule/ViewRule/CreateRule/…), so this list is the
 * boundary that keeps `/superbase` from tunneling Base's admin/settings/backup/log
 * surfaces — it stays a data-plane proxy, never a general Base tunnel. Superset of
 * the old tenants-only rule (the tenants manager still rides this same proxy).
 */
export function allowBaseSurface(path: string): boolean {
  const rel = path.replace(/^\/+/, '')
  return rel === 'v1/collections' || BASE_RECORDS.test(rel)
}
