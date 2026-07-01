/**
 * Provisioning API — managed data/storage resources, one REST surface per kind.
 *
 * Contract (hanzoai/cloud, mounted by clients/provisioningsvc):
 *   POST   /v1/<kind>        {name}        -> 201 ResourceCreated (password ONCE)
 *   GET    /v1/<kind>                      -> 200 Resource[]
 *   GET    /v1/<kind>/<name>               -> 200 Resource
 *   DELETE /v1/<kind>/<name>               -> 204
 *
 * Tenancy is server-side (X-Org-Id from the validated session); the browser
 * sends cookie credentials only. One client, parameterized by `kind` — the
 * ResourceModule factory binds a kind and gets a working admin surface.
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

export const ProvisioningApi = {
  list: (kind: ResourceKind) => restGet<Resource[]>(cloudProxyV1Url(kind)),

  get: (kind: ResourceKind, name: string) =>
    restGet<Resource>(cloudProxyV1Url(`${kind}/${encodeURIComponent(name)}`)),

  create: (kind: ResourceKind, name: string) =>
    restPost<ResourceCreated>(cloudProxyV1Url(kind), { name }),

  remove: (kind: ResourceKind, name: string) =>
    restDelete(cloudProxyV1Url(`${kind}/${encodeURIComponent(name)}`)),
}
