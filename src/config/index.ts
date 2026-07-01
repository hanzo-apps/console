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
 */

const trimSlash = (s: string) => s.replace(/\/+$/, '')

export type BrandId = 'hanzo' | 'lux' | 'zoo' | 'pars'

export type ConsoleConfig = {
  /** Resolved brand id (from hostname). */
  brand: BrandId
  /** Wordmark shown in the shell, e.g. "Lux Cloud". */
  brandName: string
  /** Unified cloud backend base URL (hanzoai/cloud /v1) — shared across brands. */
  cloudUrl: string
  /** PaaS base URL (DOKS cluster control plane) — shared. */
  platformUrl: string
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
}

/** Fields shared by every brand. Env-overridable per-deploy. */
const SHARED = {
  platformUrl: trimSlash(process.env.NEXT_PUBLIC_PLATFORM_URL ?? 'https://platform.hanzo.ai'),
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
const BRANDS: Record<BrandId, { brandName: string; iamUrl: string; iamOrgName: string; iamApp: string; adminApp: string; billingUrl: string; docsUrl: string }> = {
  hanzo: { brandName: 'Hanzo Cloud', iamUrl: 'https://hanzo.id', iamOrgName: 'hanzo', iamApp: 'hanzo-cloud', adminApp: 'admin-console', billingUrl: 'https://billing.hanzo.ai', docsUrl: 'https://docs.hanzo.ai' },
  lux: { brandName: 'Lux Cloud', iamUrl: 'https://lux.id', iamOrgName: 'lux', iamApp: 'lux-cloud', adminApp: 'admin-console', billingUrl: 'https://billing.lux.cloud', docsUrl: 'https://docs.lux.network' },
  zoo: { brandName: 'Zoo Cloud', iamUrl: 'https://zoolabs.id', iamOrgName: 'zoo', iamApp: 'zoo-cloud', adminApp: 'admin-console', billingUrl: 'https://billing.zoo.cloud', docsUrl: 'https://docs.zoo.ngo' },
  pars: { brandName: 'Pars Cloud', iamUrl: 'https://pars.id', iamOrgName: 'pars', iamApp: 'pars-cloud', adminApp: 'admin-console', billingUrl: 'https://billing.pars.cloud', docsUrl: 'https://docs.pars.network' },
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

/** Brand-aware shell branding. */
export const branding = {
  get name(): string {
    return `${resolveConfig().brandName} Console`
  },
  short: 'Cloud Console',
} as const
