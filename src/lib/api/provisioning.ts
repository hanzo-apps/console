/**
 * Provisioning API — managed data/storage resources, one REST surface per kind.
 *
 * Contract (hanzoai/cloud, mounted by clients/provisioningsvc — HIP-0139):
 *   POST   /v1/provisioning/<kind>        {name}   -> 201 ResourceCreated (password ONCE)
 *   GET    /v1/provisioning/<kind>                 -> 200 Resource[]
 *   GET    /v1/provisioning/<kind>/<name>          -> 200 Resource
 *   DELETE /v1/provisioning/<kind>/<name>          -> 204
 *
 * Transport: the browser calls the console's OWN-origin `/v1` user-bearer proxy
 * (`cloudProxyV1Url` → `<origin>/v1/provisioning/<kind>`), NEVER a bare `/v1/*`. On the
 * live console ingress a bare `/v1/*` is routed straight to hanzoai/gateway (bypassing
 * Next), where the provisioning backends authorize on the Bearer owner claim and 403 a
 * cookie-only call ("X-Org-Id required") — surfacing as a FALSE "Not enabled for your
 * account". The `/v1` route (`app/v1/[...path]`, allow-listed in proxy-allow.ts)
 * mints a short-lived user-bound IAM token from the session and forwards it, so the org
 * is resolved server-side and the real per-org resources load. Same class-fix as
 * storage.ts (`/v1/s3`) and framework — the seven data kinds share ONE proxy path.
 *
 * Tenancy is server-side (X-Org-Id from the Bearer owner); the browser sends cookie
 * credentials only. One client, parameterized by `kind` — the ResourceModule factory
 * binds a kind and gets a working admin surface.
 */
import { restGet, restPost, restDelete, cloudProxyV1Url } from './client'

/** Wire kind = the REST path segment the provisioning service serves. */
export type ResourceKind =
  | 'sql' //       Hanzo SQL       — relational
  | 'vector' //    Hanzo Vector    — vector database
  | 'datastore' // Hanzo Datastore — columnar analytics (OLAP)
  | 'kv' //        Hanzo KV        — key-value store
  | 'search' //    Hanzo Search    — full-text & hybrid
  | 's3' //        Hanzo S3        — object storage
  | 'docdb' //     Hanzo DocDB     — document database

/** A provisioned resource as listed/fetched (never carries a secret). */
export type Resource = {
  id: string
  name: string
  kind: string
  status: string
  host: string
  port: number
  username?: string
  database?: string
  createdAt?: string
}

/**
 * The create response — `connectionString` plus, on first create only, the
 * generated `password`. The backend returns the password ONCE; the UI must
 * surface it immediately and never re-fetches it.
 */
export type ResourceCreated = Resource & {
  connectionString: string
  password?: string
}

/**
 * Normalize a provisioning LIST response to a `Resource[]`.
 *
 * The contract is a bare JSON array, but a managed backend can 200 with a wrapper
 * object instead — a bare `{data|items|results|resources|collections|list|rows: […]}`,
 * or one level of nesting (e.g. a Qdrant-style `{ result: { collections: [...] } }`).
 * A non-array body reaching the list view's `for…of` / `.length` throws DURING
 * render and blanks the whole module behind the error boundary — the observed
 * Vector regression (`GET /v1/provisioning/vector` 200, but the API returns a wrapped
 * shape, so nothing renders while SQL/KV — which return bare arrays — render fine).
 *
 * So we validate + unwrap at the transport boundary (ONE place, every kind) and
 * fall back to an honest empty list — never fabricated, never a crash. Non-object
 * elements are dropped defensively so a malformed row degrades a cell, not the page.
 */
const LIST_KEYS = ['data', 'items', 'results', 'result', 'resources', 'collections', 'list', 'rows']

function extractArray(body: unknown, depth: number): unknown[] {
  if (Array.isArray(body)) return body
  if (!body || typeof body !== 'object' || depth > 2) return []
  const obj = body as Record<string, unknown>
  for (const k of LIST_KEYS) {
    if (!(k in obj)) continue
    const v = obj[k]
    if (Array.isArray(v)) return v
    const nested = extractArray(v, depth + 1) // one level down (e.g. result.collections)
    if (nested.length) return nested
  }
  return []
}

export function normalizeResourceList(body: unknown): Resource[] {
  return extractArray(body, 0).filter(
    (r): r is Resource => !!r && typeof r === 'object' && !Array.isArray(r),
  )
}

/** The REST root for a kind — one head, `provisioning`, for all seven. */
const kindUrl = (kind: ResourceKind, name?: string) =>
  cloudProxyV1Url(`provisioning/${kind}${name ? `/${encodeURIComponent(name)}` : ''}`)

export const ProvisioningApi = {
  list: async (kind: ResourceKind): Promise<Resource[]> =>
    normalizeResourceList(await restGet<unknown>(kindUrl(kind))),

  get: (kind: ResourceKind, name: string) => restGet<Resource>(kindUrl(kind, name)),

  create: (kind: ResourceKind, name: string) =>
    restPost<ResourceCreated>(kindUrl(kind), { name }),

  remove: (kind: ResourceKind, name: string) => restDelete(kindUrl(kind, name)),
}
