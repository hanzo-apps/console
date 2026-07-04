/**
 * Runtime configuration — ONE console image serves every brand.
 *
 * Tenancy model: a single cloud `/v1` backend (cloud.hanzo.ai) serves ALL orgs,
 * scoping data by the org claim; each brand authenticates against its OWN IAM
 * (hanzo→hanzo.id, lux→lux.id, zoo→zoolabs.id, pars→pars.id — all live), so the
 * cloud backend validates a per-brand issuer + `aud=<brand>-cloud`. The brand is
 * selected at RUNTIME from the request hostname (cloud.hanzo.ai → hanzo,
 * cloud.lux.cloud → lux, cloud.zoo.cloud → zoo). `config` is a brand-aware
 * proxy resolved from `window.location.hostname`, so the /v1 client + IAM SDK are
 * per-host with no other wiring. `NEXT_PUBLIC_*` still OVERRIDES per field.
 *
 * NOTE: hanzo's issuer is `hanzo.id` (NOT iam.hanzo.ai — legacy zone, iss mismatch
 * drops sign-in). zoo's IAM is `zoolabs.id` (NOT zoo.id). client_id is `<org>-cloud`
 * (HIP-0111). The cloud backend must accept all brand issuers/auds (multi-brand).
 * cloudUrl/platformUrl are shared; billingUrl is PER BRAND (each brand's own
 * billing host, resolved like iamUrl) so a brand's console links to ITS billing
 * portal, scoped to ITS org by the brand JWT. No secrets.
 *
 * NOTE (white-label tenants without their own IAM issuer): `7stars` (7stars.dev)
 * and `yotoda` (yotoda.tech) are general Hanzo-cloud customers seeded AS ORGS IN
 * the hanzo IAM (`hanzo.id`) — there is NO separate `7stars.id`/`yotoda.id` issuer.
 * So their `iamUrl` is `https://hanzo.id` (the issuer that actually holds the org),
 * with the per-brand `iamOrgName` (`7stars`/`yotoda`) + `iamApp` (`7stars-cloud`/
 * `yotoda-cloud`). Login resolves against hanzo.id, org-scoped by the JWT owner —
 * matching how the orgs/apps were provisioned. (Contrast lux/zoo/pars, which each
 * DO run their own issuer.)
 */

const trimSlash = (s: string) => s.replace(/\/+$/, '')

export type BrandId = 'hanzo' | 'lux' | 'zoo' | 'pars' | '7stars' | 'yotoda'

export type ConsoleConfig = {
  /** Resolved brand id (from hostname). */
  brand: BrandId
  /** Wordmark shown in the shell, e.g. "Lux Cloud". */
  brandName: string
  /** Unified cloud backend base URL (hanzoai/cloud /v1) — shared across brands. */
  cloudUrl: string
  /** PaaS base URL (DOKS cluster control plane) — shared. */
  platformUrl: string
  /**
   * hanzo.app builder base URL — where the Templates gallery's "Open in builder"
   * deep-links (fork a starter → customize by prompt in the builder). Shared,
   * env-overridable via NEXT_PUBLIC_APP_URL; default https://hanzo.app.
   */
  appUrl: string
  /** Canonical IAM OIDC issuer (the cloud /v1 validates) — shared. */
  iamUrl: string
  /** IAM application name (aud=hanzo-cloud) — shared. */
  iamAppName: string
  /** IAM organization name — PER BRAND (hanzo/lux/zoo). The only auth difference. */
  iamOrgName: string
  /** IAM OAuth client id (= app) — shared. */
  iamClientId: string
  /** Billing/account portal — PER BRAND. The console LINKS here, never reimplements it. */
  billingUrl: string
  /** Documentation site — PER BRAND. The console LINKS here (new tab), never embeds it. */
  docsUrl: string
  /**
   * Billing-only shell mode — TRUE on a brand's dedicated billing host
   * (billing.<brand-domain>, e.g. billing.hanzo.ai) or with NEXT_PUBLIC_BILLING_ONLY=1.
   * The SAME console image serves it; the shell just filters the nav to the Billing
   * Center and defaults the route to the billing overview, so people who only ever
   * see billing.hanzo.ai get a full, chromed billing portal — 1:1 with the Billing
   * section inside the full console (zero duplication, same components).
   */
  billingOnly: boolean
}

/** Fields shared by every brand. Env-overridable per-deploy. */
const SHARED = {
  platformUrl: trimSlash(process.env.NEXT_PUBLIC_PLATFORM_URL ?? 'https://platform.hanzo.ai'),
  appUrl: trimSlash(process.env.NEXT_PUBLIC_APP_URL ?? 'https://hanzo.app'),
}

/**
 * Cloud `/v1` base — SAME-ORIGIN by default so the session cookie is first-party
 * (cloud.hanzo.ai/v1, no SameSite=None/CORS). The console host's edge route sends
 * /v1 THROUGH the gateway (global IAM-JWT + rate-limit) to the cloud package, so
 * "everything goes through the api.hanzo.ai gateway" holds without the SPA ever
 * leaving its origin. Override with NEXT_PUBLIC_CLOUD_URL for split-origin/dev.
 */
function cloudUrl(): string {
  const env = process.env.NEXT_PUBLIC_CLOUD_URL
  if (env) return trimSlash(env)
  if (typeof window !== 'undefined') return trimSlash(window.location.origin)
  // SSR/build fallback only (real calls are browser same-origin; the gateway
  // routes the console host's /v1 to the cloud package). The canonical gated API
  // host is api.hanzo.ai (== api.cloud.hanzo.ai — the same hanzoai/cloud package).
  return 'https://api.hanzo.ai'
}

/**
 * Per-brand IAM (each org's own issuer/app) + wordmark + billing host. Cloud
 * backend is shared (one multi-tenant /v1, scoped by the brand JWT's org); IAM
 * and billingUrl are the per-brand surfaces. Each brand's billing host runs the
 * same multi-brand billing SPA, scoped to the brand's org via the brand JWT.
 */
// `adminApp` is the OAuth client used on a brand's admin console host
// (admin.<brand>). It targets an app whose IAM organization is the reserved
// `admin` org, so login resolves the global-admin identity (owner=admin) — the
// keystone of the admin.hanzo.ai cutover. The reserved admin org is ONE global
// org, so there is ONE admin login app (`admin-console`); enabling a new brand's
// admin host = add its /auth/callback to that app's redirectUris. Non-admin
// hosts keep the brand's normal `iamApp`.
//
// DEPRECATED — DATA-DRIVEN MIGRATION (white-label follow-up). This hardcoded
// `BRANDS` + `HOST_BRANDS` map is the exact "add a brand = edit code + redeploy"
// hardcode the white-label system removes. The canonical source of a brand is the
// TENANT RECORD (`organization` + `webServerSettings.{host,logoUrl,faviconUrl}` +
// the domain bindings), resolved at RUNTIME by host — see
// `TenantsApi.brandConfig(host)` + the `TenantBrandConfig` type. A new white-label
// brand must appear by CREATING A TENANT RECORD (the Tenants board does this: org +
// brand write + domain bind), NOT by adding a row here.
//
// The swap is NOT done in this pass because it is a build-time-inlined boundary
// (every `NEXT_PUBLIC_IAM_*` bakes into the image; the OAuth issuer/client is
// resolved from this map at auth time), so a wrong change breaks sign-in and the
// build. The REQUIRED follow-up: (1) the platform serves `GET /v1/brand?host=<h>`
// from the tenant records (the missing endpoint); (2) `resolveConfig` reads
// `TenantsApi.brandConfig(host)` first and falls back to this map ONLY for the four
// legacy brands until every host has a record; (3) this map is then deleted. Until
// then, treat these rows as the SEED for those tenant records, never the canonical path.
const BRANDS: Record<BrandId, { brandName: string; iamUrl: string; iamOrgName: string; iamApp: string; adminApp: string; billingUrl: string; docsUrl: string }> = {
  hanzo: { brandName: 'Hanzo Cloud', iamUrl: 'https://hanzo.id', iamOrgName: 'hanzo', iamApp: 'hanzo-cloud', adminApp: 'admin-console', billingUrl: 'https://billing.hanzo.ai', docsUrl: 'https://docs.hanzo.ai' },
  lux: { brandName: 'Lux Cloud', iamUrl: 'https://lux.id', iamOrgName: 'lux', iamApp: 'lux-cloud', adminApp: 'admin-console', billingUrl: 'https://billing.lux.cloud', docsUrl: 'https://docs.lux.network' },
  zoo: { brandName: 'Zoo Cloud', iamUrl: 'https://zoolabs.id', iamOrgName: 'zoo', iamApp: 'zoo-cloud', adminApp: 'admin-console', billingUrl: 'https://billing.zoo.cloud', docsUrl: 'https://docs.zoo.ngo' },
  pars: { brandName: 'Pars Cloud', iamUrl: 'https://pars.id', iamOrgName: 'pars', iamApp: 'pars-cloud', adminApp: 'admin-console', billingUrl: 'https://billing.pars.cloud', docsUrl: 'https://docs.pars.network' },
  // White-label cloud tenants seeded as orgs IN the hanzo IAM (hanzo.id) — no own
  // .id issuer, so iamUrl = https://hanzo.id with the per-brand org/app (see NOTE above).
  '7stars': { brandName: '7Stars Cloud', iamUrl: 'https://hanzo.id', iamOrgName: '7stars', iamApp: '7stars-cloud', adminApp: 'admin-console', billingUrl: 'https://billing.7stars.dev', docsUrl: 'https://docs.7stars.dev' },
  yotoda: { brandName: 'Yotoda Cloud', iamUrl: 'https://hanzo.id', iamOrgName: 'yotoda', iamApp: 'yotoda-cloud', adminApp: 'admin-console', billingUrl: 'https://billing.yotoda.tech', docsUrl: 'https://docs.yotoda.tech' },
}

/** Hostname suffix → brand. First match wins. */
const HOST_BRANDS: ReadonlyArray<{ suffix: string; brand: BrandId }> = [
  { suffix: 'hanzo.ai', brand: 'hanzo' },
  { suffix: 'lux.cloud', brand: 'lux' },
  { suffix: 'lux.network', brand: 'lux' },
  { suffix: 'lux.id', brand: 'lux' },
  { suffix: 'zoo.cloud', brand: 'zoo' },
  { suffix: 'zoo.ngo', brand: 'zoo' },
  { suffix: 'zoo.network', brand: 'zoo' },
  { suffix: 'zoolabs.id', brand: 'zoo' },
  { suffix: 'hanzo.id', brand: 'hanzo' },
  { suffix: 'pars.cloud', brand: 'pars' },
  { suffix: 'pars.network', brand: 'pars' },
  // White-label cloud tenants. One suffix each covers every subdomain
  // (cloud.7stars.dev, console.7stars.dev, …) via the `endsWith('.'+suffix)` match.
  { suffix: '7stars.dev', brand: '7stars' },
  { suffix: 'yotoda.tech', brand: 'yotoda' },
]

/** Resolve the brand id from a hostname (port/case-insensitive). Defaults to hanzo. */
export function brandFromHost(host?: string | null): BrandId {
  const hostname = (host ?? '').toLowerCase().replace(/:\d+$/, '').trim()
  if (hostname) {
    for (const e of HOST_BRANDS) {
      if (hostname === e.suffix || hostname.endsWith('.' + e.suffix)) return e.brand
    }
  }
  return 'hanzo'
}

/** Current hostname: window in the browser, NEXT_PUBLIC_DEFAULT_HOST for SSR/build. */
function currentHost(): string {
  if (typeof window !== 'undefined') return window.location.hostname
  return process.env.NEXT_PUBLIC_DEFAULT_HOST ?? 'cloud.hanzo.ai'
}

/** Normalize a host for keying/matching (lowercase, strip port). */
function normHost(host?: string | null): string {
  return (host ?? '').toLowerCase().replace(/:\d+$/, '').trim()
}

/**
 * True on a brand admin console host (admin.<brand>, e.g. admin.hanzo.ai). Such
 * hosts authenticate against the admin-org OAuth app (`adminApp`) so login
 * resolves the global-admin identity, whereas every normal host uses `iamApp`.
 */
export function isAdminHost(host?: string | null): boolean {
  return normHost(host).startsWith('admin.')
}

/**
 * True on a brand's dedicated billing host (billing.<brand>, e.g. billing.hanzo.ai
 * / billing.lux.cloud / billing.zoo.cloud). Such a host runs the SAME console image
 * but in billing-only shell mode (nav filtered to the Billing Center, default route
 * → billing overview). Strict `billing.` prefix — no false positives.
 */
export function isBillingOnlyHost(host?: string | null): boolean {
  return normHost(host).startsWith('billing.')
}

/**
 * Billing-only mode for a host: the dedicated billing host OR an explicit
 * NEXT_PUBLIC_BILLING_ONLY=1 override (dev / preview). The env is baked at build,
 * the host is resolved at runtime — either turns the shell into a billing portal.
 */
export function isBillingOnly(host?: string | null): boolean {
  return process.env.NEXT_PUBLIC_BILLING_ONLY === '1' || isBillingOnlyHost(host)
}

// Cache is keyed by NORMALIZED HOST (not brand): admin.hanzo.ai and
// cloud.hanzo.ai are the same brand but MUST resolve to different clients
// (admin-console vs hanzo-cloud), so a brand-keyed cache would collide.
const cache = new Map<string, ConsoleConfig>()

/** Resolve the full config for the current host. iamOrgName overridable via env. */
export function resolveConfig(host: string = currentHost()): ConsoleConfig {
  const key = normHost(host) || 'default'
  const cached = cache.get(key)
  if (cached) return cached
  const brand = brandFromHost(host)
  const b = BRANDS[brand]
  // On an admin host, the login client is the admin-org app; otherwise the
  // brand's normal cloud app. iamAppName and iamClientId travel together (same
  // app). An explicit NEXT_PUBLIC_* override still wins (unchanged precedence).
  const app = isAdminHost(host) ? b.adminApp : b.iamApp
  const resolved: ConsoleConfig = {
    brand,
    brandName: b.brandName,
    cloudUrl: cloudUrl(),
    iamUrl: trimSlash(process.env.NEXT_PUBLIC_IAM_URL ?? b.iamUrl),
    iamOrgName: process.env.NEXT_PUBLIC_IAM_ORG_NAME ?? b.iamOrgName,
    iamAppName: process.env.NEXT_PUBLIC_IAM_APP_NAME ?? app,
    iamClientId: process.env.NEXT_PUBLIC_IAM_CLIENT_ID ?? app,
    billingUrl: trimSlash(process.env.NEXT_PUBLIC_BILLING_URL ?? b.billingUrl),
    docsUrl: trimSlash(process.env.NEXT_PUBLIC_DOCS_URL ?? b.docsUrl),
    billingOnly: isBillingOnly(host),
    ...SHARED,
  }
  cache.set(key, resolved)
  return resolved
}

/**
 * Brand-aware config. Reading any field resolves the brand from the current
 * hostname, so `config.iamOrgName` / `config.cloudUrl` etc. are correct per host
 * with no consumer changes.
 */
export const config: ConsoleConfig = new Proxy({} as ConsoleConfig, {
  get: (_t, key: string) => resolveConfig()[key as keyof ConsoleConfig],
})

// Shared product-release label. The console app's major.minor IS the umbrella
// "Hanzo Cloud <release>" — one source (package.json → NEXT_PUBLIC_APP_VERSION),
// never hardcoded twice. cloud ships its own Go v1.x build under the same
// umbrella; only this label is unified, not the build versions.
const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? ''
const PRODUCT_RELEASE = APP_VERSION.split('.').slice(0, 2).join('.')

/** Brand-aware shell branding. */
export const branding = {
  get name(): string {
    return `${resolveConfig().brandName} Console`
  },
  short: 'Cloud Console',
  /** Full console build version, e.g. "8.4.11". */
  appVersion: APP_VERSION,
  /** Shared product-release, e.g. "8.4" (console major.minor). */
  release: PRODUCT_RELEASE,
  /** Umbrella product-line label, e.g. "Hanzo Cloud 8.4". */
  get productLine(): string {
    return PRODUCT_RELEASE ? `${resolveConfig().brandName} ${PRODUCT_RELEASE}` : resolveConfig().brandName
  },
} as const
