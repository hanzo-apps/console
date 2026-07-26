/**
 * Tenants / White-Label API — the ONE client for the tenant management board.
 *
 * It COMPOSES the three real backends the console already talks to (no new backend,
 * no fabrication) and adds the provisioning calls that ride the EXISTING `/paas`
 * proxy — which forwards ANY path to the ONE Hanzo API endpoint at `/v1/paas/*`
 * with the service token (server-only, KMS-sourced) behind the brand-admin gate
 * + CSRF. So:
 *
 *   REAL today (the platform serves these):
 *     - IAM orgs         → `IamAdminApi.organizations` (`/admin/iam`, global-admin gate) → the tenant list + brand.
 *     - Billing/plan     → `AdminCockpitApi.customers` (`/v1/admin/customers`, global-admin gate) → plan/wallet/status.
 *     - Clusters         → `/paas` `GET /v1/org/{org}/cluster` → the tenant's dedicated cluster.
 *     - Provision cluster→ `/paas` `POST /v1/org/{org}/cluster` (+ install-baseline) → real DOKS provisioning.
 *     - IAM app (create) → `IamAdminApi.addApplication` (`/admin/iam`, allow-listed) → the tenant's own IAM app.
 *     - Suspend/reactivate→ `AdminCockpitApi.suspend/reactivate` → enable/disable the whole tenant (REAL).
 *
 *   HONEST-NOT-CONNECTED (the platform serves NO HTTP route for these — the calls ride
 *   `/paas` and read live wherever the platform serves them; where it does not, a 404
 *   renders the honest "endpoint not served here" state — NEVER a fabricated success):
 *     - Bind domain          → `POST /paas/org/{org}/domain` (createDomain + cloudflare + k8s-ingress are
 *                              INTERNAL platform functions with no HTTP surface → foundation follow-up).
 *     - Provision package    → `POST /paas/org/{org}/package/{id}` (a composite `provisionPackage(org,pkg)`
 *                              does NOT exist — clusters are the only unit provisioned → follow-up).
 *     - Deprovision package  → `DELETE /paas/org/{org}/package/{id}`.
 *     - Write brand          → `PATCH /paas/org/{org}/brand` (webServerSettings is a global singleton;
 *                              organization.metadata is the only per-org store → follow-up).
 *
 * Every list read is optional-safe and degrades to an honest empty; nothing invents
 * a tenant, a package-as-deployed, a domain, or a cluster.
 */
import { restGet, restPost, restDelete, restPut } from './client'
import { normalizePackages, type Package } from '~/components/products/tenants/packages'

// ── platform (/paas) — the same-origin service-token proxy (brand-admin gated) ──

/** Same-origin `/paas` path. The proxy prefixes `/v1/` + attaches the service token. */
const paas = (path: string): string => `/paas/${path.replace(/^\/+/, '')}`
const enc = encodeURIComponent

/** A tenant's dedicated cluster (subset of the platform's `DoksClusterWithPools`). */
export type TenantCluster = {
  name: string
  region?: string
  status?: string
  phase?: string
}

/** A bound domain record for a tenant (`GET /paas/org/{org}/domain`). */
export type TenantDomain = {
  host: string
  serviceName?: string
  https?: boolean
  /** Provisioning state of the ingress/DNS/cert (e.g. pending|active|error). */
  status?: string
}

/** Pull a domain list out of `{domains:[…]}` / `{data:[…]}` / a bare array (defensive). */
const domainsOf = (payload: unknown): TenantDomain[] => {
  const rows = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object'
      ? ((payload as Record<string, unknown>).domains as unknown[]) ??
        ((payload as Record<string, unknown>).data as unknown[]) ??
        []
      : []
  return (Array.isArray(rows) ? rows : []).map((r) => {
    const o = (r ?? {}) as Record<string, unknown>
    return {
      host: String(o.host ?? ''),
      serviceName: typeof o.serviceName === 'string' ? o.serviceName : undefined,
      https: o.https === true,
      status: typeof o.status === 'string' ? o.status : typeof o.phase === 'string' ? o.phase : undefined,
    }
  })
}

/** Pull a cluster list out of `{clusters:[…]}` / `{data:[…]}` / a bare array (defensive). */
const clustersOf = (payload: unknown): TenantCluster[] => {
  const rows = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object'
      ? ((payload as Record<string, unknown>).clusters as unknown[]) ??
        ((payload as Record<string, unknown>).data as unknown[]) ??
        []
      : []
  return (Array.isArray(rows) ? rows : []).map((r) => {
    const o = (r ?? {}) as Record<string, unknown>
    return {
      name: String(o.name ?? o.doksClusterId ?? ''),
      region: typeof o.region === 'string' ? o.region : undefined,
      status: typeof o.status === 'string' ? o.status : undefined,
      phase: typeof o.phase === 'string' ? o.phase : undefined,
    }
  })
}

/** Bind a custom domain to a tenant — the platform auto-creates DNS + ingress + cert. */
export type BindDomainInput = {
  /** The custom host, e.g. `admin.lux.network`. */
  host: string
  /** The upstream service this host routes to (the tenant's console/app service). */
  serviceName?: string
  /** The upstream port (default 80/the ingress-class default). */
  port?: number
}

/** The tenant's per-tenant brand (host + logo/favicon), written to webServerSettings/metadata. */
export type BrandInput = {
  host?: string
  logoUrl?: string
  faviconUrl?: string
  appName?: string
}

/**
 * The runtime BRAND CONFIG for a request host — the DATA-DRIVEN replacement for the
 * hardcoded `BRANDS`/`HOST_BRANDS` map in `src/config/index.ts`. Resolved from the
 * tenant records (`organization` + `webServerSettings.{host,logoUrl,faviconUrl}` +
 * the domain bindings), keyed by host. A new white-label brand appears by CREATING a
 * tenant record (org + brand + domain), never by editing a code map.
 */
export type TenantBrandConfig = {
  /** The org this host resolves to (the tenant slug). */
  org: string
  brandName: string
  logoUrl?: string
  faviconUrl?: string
  /** The OIDC issuer for this host (own-issuer tenants differ from the shared brand). */
  iamUrl?: string
  /** The `<org>-<app>` client id for login on this host. */
  iamApp?: string
  accentColor?: string
}

/** Normalize a raw brand-config record. Optional-safe; returns null when it has no org. */
const normalizeBrandConfig = (raw: unknown): TenantBrandConfig | null => {
  const r = (raw ?? {}) as Record<string, unknown>
  const s = (v: unknown): string => (typeof v === 'string' ? v : '')
  const org = s(r.org) || s(r.iamOrgName)
  if (!org) return null
  return {
    org,
    brandName: s(r.brandName) || org,
    logoUrl: s(r.logoUrl) || undefined,
    faviconUrl: s(r.faviconUrl) || undefined,
    iamUrl: s(r.iamUrl) || undefined,
    iamApp: s(r.iamApp) || undefined,
    accentColor: s(r.accentColor) || undefined,
  }
}

export const TenantsApi = {
  /**
   * The PACKAGE catalog — DATA, read from the platform (`GET /paas/packages` →
   * `api.hanzo.ai/v1/paas/packages`). The catalog is NOT hardcoded in the console:
   * adding a package is a platform DB row (+ reseed from `platform-seed/packages.json`),
   * never a console code edit. HONEST-NOT-CONNECTED today: the platform has no
   * `package` table / `/v1/packages` route yet, so this 404s and the UI shows the
   * honest not-connected state (never a fabricated catalog). It lights up the moment
   * the platform serves the seeded rows.
   */
  packages: async (): Promise<Package[]> => normalizePackages(await restGet<unknown>(paas('packages'))),

  /**
   * A tenant org's dedicated DOKS clusters (`GET /paas/org/{org}/cluster`). Honest
   * empty when the org runs on shared Hanzo Cloud (the default). REAL.
   */
  clusters: async (org: string): Promise<TenantCluster[]> =>
    clustersOf(await restGet<unknown>(paas(`org/${enc(org)}/cluster`))),

  /**
   * A tenant's bound custom domains (`GET /paas/org/{org}/domain`). The set of routed
   * hosts is DERIVED from these records — no hardcoded host list. HONEST-NOT-CONNECTED
   * today (the platform has no domain HTTP route yet); 404 → honest empty/not-connected.
   */
  domains: async (org: string): Promise<TenantDomain[]> =>
    domainsOf(await restGet<unknown>(paas(`org/${enc(org)}/domain`))),

  /**
   * Resolve the BRAND CONFIG for a request host from the tenant records
   * (`GET /paas/brand?host=<h>` → the platform reads `webServerSettings.host` →
   * `organization` + brand fields). This is the DATA-DRIVEN replacement for the
   * hardcoded `BRANDS`/`HOST_BRANDS` map in `src/config/index.ts` — a new brand is a
   * tenant record, not a code edit. HONEST-NOT-CONNECTED today: the platform has no
   * host→brand route yet, so this 404s and the caller keeps the (deprecated) map as a
   * fallback. When the platform serves it, `resolveConfig` reads THIS per host.
   */
  brandConfig: async (host: string): Promise<TenantBrandConfig | null> =>
    normalizeBrandConfig(await restGet<unknown>(paas(`brand?host=${enc(host)}`))),

  /**
   * Provision a dedicated DOKS cluster for a tenant (`POST /paas/org/{org}/cluster`).
   * The DO token is read server-side (KMS). REAL — the platform serves this.
   */
  provisionCluster: (
    org: string,
    input: { region: string; nodeSize: string; nodeCount: number; ha?: boolean },
  ): Promise<TenantCluster> =>
    restPost<{ cluster?: TenantCluster }>(paas(`org/${enc(org)}/cluster`), {
      organizationId: org,
      region: input.region,
      nodeSize: input.nodeSize,
      nodeCount: input.nodeCount,
      ha: input.ha ?? false,
    }).then((r) => r?.cluster ?? { name: '', phase: 'provisioning' }),

  /**
   * Install the ingress/gateway/operator baseline on a freshly-provisioned cluster
   * (`POST /paas/org/{org}/cluster/{cid}/install-baseline`). REAL.
   */
  installBaseline: (org: string, clusterId: string): Promise<void> =>
    restPost<unknown>(paas(`org/${enc(org)}/cluster/${enc(clusterId)}/install-baseline`), {}).then(() => undefined),

  /**
   * Bind a custom domain to a tenant, auto-creating the ingress + DNS + cert
   * (`POST /paas/org/{org}/domain`). HONEST-NOT-CONNECTED: the platform's
   * `createDomain` / cloudflare / k8s-ingress services expose NO HTTP route, so this
   * 404s (rendered as the honest "endpoint not served here" state) and reads live
   * wherever the platform mounts the route. This REPLACES the
   * hand-made throwaway ingresses (`console-admin-lux-network`, `console-admin-zoo-cloud`).
   */
  bindDomain: (org: string, input: BindDomainInput): Promise<void> =>
    restPost<unknown>(paas(`org/${enc(org)}/domain`), {
      host: input.host,
      serviceName: input.serviceName,
      port: input.port,
      https: true,
      certificateType: 'letsencrypt',
    }).then(() => undefined),

  /**
   * Provision a PACKAGE (bundle of services) for a tenant
   * (`POST /paas/org/{org}/package/{id}`). HONEST-NOT-CONNECTED: a composite
   * `provisionPackage(org, pkg)` does not exist on the platform yet (clusters are
   * the only unit provisioned), so this 404s today and lights up when the platform
   * serves the composite. Never fabricates a "deployed" package.
   */
  provisionPackage: (org: string, packageId: string): Promise<void> =>
    restPost<unknown>(paas(`org/${enc(org)}/package/${enc(packageId)}`), { packageId }).then(() => undefined),

  /** Deprovision a package (`DELETE /paas/org/{org}/package/{id}`). HONEST-NOT-CONNECTED. */
  deprovisionPackage: (org: string, packageId: string): Promise<void> =>
    restDelete(paas(`org/${enc(org)}/package/${enc(packageId)}`)),

  /**
   * Write the tenant's brand — host + logo/favicon (`PATCH /paas/org/{org}/brand`).
   * HONEST-NOT-CONNECTED: `webServerSettings` is a global singleton and there is no
   * per-tenant brand-write route yet, so this 404s today. Brand READ is real (the
   * org's logo/favicon/theme come from IAM `get-organization`). Follow-up.
   */
  writeBrand: (org: string, input: BrandInput): Promise<void> =>
    restPut<unknown>(paas(`org/${enc(org)}/brand`), input).then(() => undefined),
}
