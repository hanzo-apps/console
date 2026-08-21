'use client'

/**
 * Generic managed-resource admin module — ONE factory, every data/storage kind.
 *
 * `resourceModule({ kind, productLabel, connectionHint })` returns a route
 * component that drives the provisioning contract for a single kind:
 *   - GET    /v1/provisioning/<kind>          -> a fleet of resources (name, status, endpoint, created)
 *   - POST   /v1/provisioning/<kind> {name}   -> create; the 201 carries `connectionString` and a
 *     `password` returned ONCE — surfaced immediately in a copyable reveal, never re-fetched.
 *   - GET    /v1/provisioning/<kind>/<name>   -> one resource (no secret) — the detail overview.
 *   - DELETE /v1/provisioning/<kind>/<name>   -> delete (with confirm).
 *
 * The surface is a polished console tuned by a per-kind `ResourceSpec` (see
 * `resource/logic.ts`): a list/home view with a real fleet stat row, a tabbed
 * primary area, a right rail, and the real create flow (`ResourceListView`), plus
 * a single-instance console (`ResourceInstanceView`) selected by the `name` route
 * param. Tenancy is server-side (the gateway injects X-Org-Id from the session),
 * so the browser sends cookie credentials only. Every metric is derived from real
 * data or rendered as an honest "—"; nothing is fabricated.
 *
 * `resourceRoutes(opts)` returns the index + `:name` routes bound to ONE component
 * instance — registry entries declare a managed kind with a single call.
 */
import { useRouter } from '~/lib/router'

import type { ResourceKind } from '~/lib/api'
import type { ProductRoute } from '~/lib/products/registry'
import { ResourceListView } from './resource/ResourceListView'
import { ResourceInstanceView } from './resource/ResourceInstanceView'

export type ResourceModuleOpts = {
  /** Provisioning wire kind, e.g. 'sql'. */
  kind: ResourceKind
  /** Product display name, e.g. 'Hanzo SQL'. */
  productLabel: string
  /** One-line hint on how to use the connection string (shown in Access). */
  connectionHint?: string
}

/**
 * Build a resource admin module bound to one provisioning kind. The returned
 * component is a registry route component (`{ params }`): the list/home console at
 * the index, the single-instance console when a `name` param is present.
 */
export function resourceModule(opts: ResourceModuleOpts) {
  return function ResourceModuleScreen({ params }: { params: Record<string, string> }) {
    const router = useRouter()
    const base = `/${opts.kind}`
    const name = params.name
    if (name) {
      return (
        <ResourceInstanceView
          kind={opts.kind}
          productLabel={opts.productLabel}
          connectionHint={opts.connectionHint}
          name={decodeURIComponent(name)}
          onBack={() => router.push(base)}
        />
      )
    }
    return (
      <ResourceListView
        kind={opts.kind}
        productLabel={opts.productLabel}
        connectionHint={opts.connectionHint}
        onOpen={(r) => router.push(`${base}/${encodeURIComponent(r.name)}`)}
      />
    )
  }
}

/**
 * The index + `:name` routes for a managed kind, bound to ONE component instance
 * — a registry entry declares a data product with a single call.
 */
export function resourceRoutes(opts: ResourceModuleOpts): ProductRoute[] {
  const component = resourceModule(opts)
  return [
    { path: '', component },
    { path: ':name', component },
  ]
}
