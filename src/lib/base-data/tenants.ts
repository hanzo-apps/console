/**
 * BaseTenantsApi — the org's Hanzo Base INSTANCES ("Bases").
 *
 * A "Base" is a row in the SuperBase orchestrator's `tenants` collection
 * (base.hanzo.ai): a name + slug (which becomes its own `<slug>.base.hanzo.ai`
 * subdomain and K8s workload), a spec (replicas + storage), and a
 * controller-reconciled status/subdomain. Listing / creating / configuring Bases
 * IS reading and writing `tenants` records — so this reuses the ONE Base client
 * (`BaseDataApi`) against that collection; it does not re-implement Base.
 *
 * Transport is same-origin `/v1` → cloud's `/v1/collections/*` Base data-plane
 * forward (clients/base/collections.go): the client attaches the caller's PKCE
 * Bearer, cloud validates it and forwards it to the managed Base, which scopes every
 * `tenants` read/write to the token subject (its ListRule `owner_iam_user =
 * @request.auth.id`) — the derive-once model, never a browser-supplied org.
 */
import { BaseDataApi, type BaseRecord } from './api'

/** The orchestrator collection whose records ARE the org's Base instances. */
export const TENANTS_COLLECTION = 'tenants'

/** A Base instance's declared shape (replicas + storage) — a small size, not raw K8s. */
export interface BaseSpec {
  replicas?: number
  storage?: string
}

/** One Hanzo Base instance (a normalized `tenants` record). */
export interface BaseInstance {
  id: string
  name: string
  slug: string
  /** Controller-set lifecycle status ('' while just-created / provisioning). */
  status: string
  /** Controller-set live subdomain (present once the Base is reconciled + ready). */
  subdomain: string
  spec: BaseSpec
  /** Controller-set last reconcile error (empty when healthy). */
  lastError: string
  created?: string
  updated?: string
}

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined

/** Normalize a raw `tenants` record into a `BaseInstance` (defensive over the wire shape). */
export function normalizeBase(raw: BaseRecord | Record<string, unknown> | null | undefined): BaseInstance {
  const o = (raw ?? {}) as Record<string, unknown>
  const spec: BaseSpec = {}
  const rawSpec = o.spec
  if (rawSpec && typeof rawSpec === 'object') {
    const s = rawSpec as Record<string, unknown>
    const replicas = num(s.replicas)
    if (replicas !== undefined) spec.replicas = replicas
    if (typeof s.storage === 'string' && s.storage) spec.storage = s.storage
  }
  return {
    id: str(o.id),
    name: str(o.name) || str(o.slug),
    slug: str(o.slug),
    status: str(o.status),
    subdomain: str(o.subdomain),
    spec,
    lastError: str(o.last_error),
    created: str(o.created) || undefined,
    updated: str(o.updated) || undefined,
  }
}

export interface CreateBaseInput {
  name: string
  slug: string
  spec?: BaseSpec
}

export class BaseTenantsApi {
  private readonly api: BaseDataApi

  constructor(baseUrl: string) {
    this.api = new BaseDataApi({ baseUrl })
  }

  /** List the org's Bases (its `tenants` records), newest data first (sorted in the UI). */
  async list(): Promise<BaseInstance[]> {
    const res = await this.api.listRecords(TENANTS_COLLECTION, { perPage: 200 })
    return res.items.map(normalizeBase)
  }

  /** One Base by record id. */
  async get(id: string): Promise<BaseInstance> {
    return normalizeBase(await this.api.getRecord(TENANTS_COLLECTION, id))
  }

  /**
   * Create a Base — `POST /v1/collections/tenants/records`. The orchestrator's
   * plugin reconciles a real Base workload (`<slug>.base.hanzo.ai`) and stamps
   * status/subdomain back on the record; Base scopes the write to the caller's org
   * (the proxy stamps `X-Org-Id` from the JWT owner).
   */
  async create(input: CreateBaseInput): Promise<BaseInstance> {
    const body: Record<string, unknown> = { name: input.name, slug: input.slug }
    if (input.spec && (input.spec.replicas !== undefined || input.spec.storage)) body.spec = input.spec
    return normalizeBase(await this.api.createRecord(TENANTS_COLLECTION, body))
  }

  /** Reconfigure a Base's name and/or spec — `PATCH .../records/<id>`. */
  async update(id: string, patch: { name?: string; spec?: BaseSpec }): Promise<BaseInstance> {
    const body: Record<string, unknown> = {}
    if (patch.name !== undefined) body.name = patch.name
    if (patch.spec !== undefined) body.spec = patch.spec
    return normalizeBase(await this.api.updateRecord(TENANTS_COLLECTION, id, body))
  }

  /** Delete a Base — `DELETE .../records/<id>` (deprovisions the workload). */
  async remove(id: string): Promise<void> {
    await this.api.deleteRecord(TENANTS_COLLECTION, id)
  }
}
