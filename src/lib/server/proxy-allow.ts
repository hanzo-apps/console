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
  // CRM (cloud clients/crm): /v1/crm/{summary,companies,contacts,opportunities}[/:id].
  // Native-Go per-org CRM on Base/SQLite (companies/contacts/opportunities). The
  // handler resolves the org from the Bearer owner (X-Org-Id) and 403s a cookie-only
  // call, so it routes through /cloud exactly like prompts/agents — the single `crm`
  // head admits every sub-path (summary, the three collections, their :id detail).
  'crm',
  // Unified analytics (cloud clients/analytics): /v1/analytics/{overview,timeseries,
  // realtime,top/*,llm/*}. Read-only per-org warehouse (datastore/ClickHouse); the
  // handler resolves the org from the Bearer owner (X-Org-Id) and 403s a cookie-only
  // call, so it routes through /cloud like prompts/agents. Multi-segment sub-paths
  // (top/referrers, llm/overview) are admitted by the single `analytics` head.
  'analytics',
  // Evals facade (cloud clients/eval): /v1/evals/{scores,datasets,dataset-items,
  // evaluators,runs}. Single-segment sub-paths under the one `evals` head; the
  // facade resolves the console project key pair from the request tenant (the
  // Bearer owner), so routing it through /cloud gives correct per-org scoping —
  // the same reason it must NOT be a cookie-only same-origin call (that 403s).
  'evals',
  // Read-only starter-kit gallery (cloud clients/templates): /v1/templates[/:slug].
  // Public reference content (no org scoping) but routed through /cloud like the
  // rest of the surface so dev + prod share ONE path.
  'templates',
  // Buildable/deployable projects store (cloud clients/projectsvc): /v1/projects[/*],
  // incl. POST /v1/projects/fork (fork a gallery template into a real project). The
  // handler resolves the org from the Bearer owner (X-Org-Id) and 403s a cookie-only
  // call, so it routes through /cloud like the rest of the surface.
  'projects',
  // PaaS control plane (cloud clients/platform): /v1/platform/{projects,projects/:p/
  // apps,apps/:a/deploy,.../deployments,.../deployments/:id/logs,health}. Per-org
  // container-app platform on Base/SQLite; SanitizeIdentity resolves the org from the
  // Bearer owner and 403s a cookie-only call, so it routes through /cloud like the
  // rest — the single `platform` head admits every project/app/deployment sub-path.
  'platform',
  // ── Native cloud infra surfaces (the unified cloud binary now serves these
  // per-org at /v1/*, previously the admin `/paas` control plane). Each resolves the
  // org from the Bearer owner (X-Org-Id) and 403s a cookie-only call, so it routes
  // through /cloud exactly like the rest; one head admits every sub-path.
  //
  // Compute (visor-backed): machines inventory + launch/quote/terminate
  // (/v1/machines[/launch|/:id]); GPU inventory + alerts + pools (/v1/gpus[/alerts|
  // /pools]); dedicated clusters + node-pool add/scale/delete (/v1/clusters[/:cid/
  // pools[/:pid[/scale]]]).
  'machines',
  'gpus',
  'clusters',
  // DO-native: virtual private clouds and managed load balancers — FULL CRUD
  // (/v1/vpcs[/:id], /v1/load-balancers[/:id]).
  'vpcs',
  'load-balancers',
  // Platform aggregates (read-only, derived): deploy targets, CI pipelines, image/
  // binary builds, and versioned releases (/v1/{environments,pipelines,builds,releases}).
  'environments',
  'pipelines',
  'builds',
  'releases',
  // Networking (zt-backed, Hanzo Zero Trust / OpenZiti fabric): the org's overlay
  // networks (/v1/networks[/:id]), mesh services (/v1/mesh/services), and edge nodes
  // (/v1/edge/nodes). One head per console page — Networks / ServiceMesh / Edge.
  'networks',
  'mesh',
  'edge',
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

/** Matches a single content-type (collection) admin path `v1/collections/<name>` —
 *  view / update / delete ONE collection. The content-type builder needs this. */
const BASE_COLLECTION = /^v1\/collections\/[^/]+$/

/**
 * VictoriaMetrics READ endpoints reachable through `/telemetry` (the platform
 * status/metrics proxy). VictoriaMetrics is Prometheus-compatible; only the
 * READ/query surface is admitted — never `/api/v1/write`, `/api/v1/import`, admin,
 * or `/-/reload`. This keeps the proxy a read-only telemetry window, so a signed-in
 * user can see live platform health/metrics but can never write or mutate the TSDB.
 */
const TELEMETRY_READ = new Set([
  'api/v1/query',
  'api/v1/query_range',
  'api/v1/series',
  'api/v1/labels',
  'api/v1/status/tsdb',
  'api/v1/metadata',
])
/** Matches `api/v1/label/<name>/values` (one clean label-name segment). */
const TELEMETRY_LABEL_VALUES = /^api\/v1\/label\/[^/]+\/values$/

/** True iff `path` is an allow-listed, READ-only VictoriaMetrics query endpoint. */
export function allowTelemetrySurface(path: string): boolean {
  const rel = path.replace(/^\/+/, '')
  return TELEMETRY_READ.has(rel) || TELEMETRY_LABEL_VALUES.test(rel)
}

/**
 * True iff `path` targets the Hanzo Base COLLECTION surface reachable through
 * `/superbase` as the signed-in user:
 *  - `v1/collections` — list the schemas (read) AND create a content type (POST);
 *  - `v1/collections/meta/scaffolds` — the base/auth/view field-template palette;
 *  - `v1/collections/<name>` — view / update / delete ONE content type (the builder);
 *  - `v1/collections/<name>/records[/<id>]` — that collection's records CRUD.
 *
 * Base authorizes every one of these itself: records by each collection's
 * ListRule/ViewRule/CreateRule/…, and ALL collection mutation behind its own
 * superuser gate (an org admin's minted token qualifies; a plain member gets an
 * honest 403), scoped per-org by the `X-Org-Id` the proxy stamps from the JWT
 * owner. This allow-list is the defense-in-depth boundary that keeps `/superbase`
 * from tunneling Base's NON-collection admin (settings / backups / logs) — it
 * stays a collections proxy, never a general Base tunnel.
 */
export function allowBaseSurface(path: string): boolean {
  const rel = path.replace(/^\/+/, '')
  if (rel === 'v1/collections') return true
  if (rel === 'v1/collections/meta/scaffolds') return true
  if (BASE_RECORDS.test(rel)) return true
  if (BASE_COLLECTION.test(rel)) return true
  return false
}
