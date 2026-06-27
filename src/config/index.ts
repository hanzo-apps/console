/**
 * Runtime configuration — ONE console image serves every brand.
 *
 * Tenancy model: a single cloud `/v1` backend (cloud.hanzo.ai) serves ALL orgs,
 * scoping data by the org claim; each brand authenticates against its OWN IAM
 * (hanzo→hanzo.id, lux→lux.id, zoo→zoolabs.id, pars→pars.id — all live), so the
 * cloud backend validates a per-brand issuer + `aud=<brand>-cloud`. The brand is
 * selected at RUNTIME from the request hostname (console.hanzo.ai → hanzo,
 * console.lux.cloud → lux, console.zoo.cloud → zoo). `config` is a brand-aware
 * proxy resolved from `window.location.hostname`, so the /v1 client + IAM SDK are
 * per-host with no other wiring. `NEXT_PUBLIC_*` still OVERRIDES per field.
 *
 * NOTE: hanzo's issuer is `hanzo.id` (NOT iam.hanzo.ai — legacy zone, iss mismatch
 * drops sign-in). zoo's IAM is `zoolabs.id` (NOT zoo.id). client_id is `<org>-cloud`
 * (HIP-0111). The cloud backend must accept all brand issuers/auds (multi-brand);
 * cloudUrl/platformUrl/billingUrl are shared today (hanzo hosts). No secrets.
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
  /** Billing/account portal — the console LINKS here, never reimplements it. */
  billingUrl: string
}

/** Fields shared by every brand. Env-overridable per-deploy. */
const SHARED = {
  platformUrl: trimSlash(process.env.NEXT_PUBLIC_PLATFORM_URL ?? 'https://platform.hanzo.ai'),
  billingUrl: trimSlash(process.env.NEXT_PUBLIC_BILLING_URL ?? 'https://billing.hanzo.ai'),
}

/**
 * Cloud `/v1` base — SAME-ORIGIN by default so the session cookie is first-party
 * on every brand host (console.lux.cloud/v1 → backend, no SameSite=None/CORS).
 * Each console host's ingress proxies /v1 to the shared cloud backend. Override
 * with NEXT_PUBLIC_CLOUD_URL for split-origin/dev.
 */
function cloudUrl(): string {
  const env = process.env.NEXT_PUBLIC_CLOUD_URL
  if (env) return trimSlash(env)
  if (typeof window !== 'undefined') return trimSlash(window.location.origin)
  // SSR/build fallback only (real calls are browser same-origin → each console
  // host's ingress proxies /v1 to the gateway). Canonical entry is the unified
  // gated/priced gateway api.hanzo.ai (hanzoai/ingress → hanzoai/gateway →
  // cloud / separate services / per-org k8s) — NOT cloud.hanzo.ai (SPA host) and
  // NOT api.cloud.hanzo.ai direct (bypasses rate-limit/gating/pricing).
  return 'https://api.hanzo.ai'
}

/** Per-brand IAM (each org's own issuer/app) + wordmark. Cloud backend is shared. */
const BRANDS: Record<BrandId, { brandName: string; iamUrl: string; iamOrgName: string; iamApp: string }> = {
  hanzo: { brandName: 'Hanzo Cloud', iamUrl: 'https://hanzo.id', iamOrgName: 'hanzo', iamApp: 'hanzo-cloud' },
  lux: { brandName: 'Lux Cloud', iamUrl: 'https://lux.id', iamOrgName: 'lux', iamApp: 'lux-cloud' },
  zoo: { brandName: 'Zoo Cloud', iamUrl: 'https://zoolabs.id', iamOrgName: 'zoo', iamApp: 'zoo-cloud' },
  pars: { brandName: 'Pars Cloud', iamUrl: 'https://pars.id', iamOrgName: 'pars', iamApp: 'pars-cloud' },
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
  return process.env.NEXT_PUBLIC_DEFAULT_HOST ?? 'console.hanzo.ai'
}

const cache = new Map<BrandId, ConsoleConfig>()

/** Resolve the full config for the current host. iamOrgName overridable via env. */
export function resolveConfig(host: string = currentHost()): ConsoleConfig {
  const brand = brandFromHost(host)
  const cached = cache.get(brand)
  if (cached) return cached
  const b = BRANDS[brand]
  const resolved: ConsoleConfig = {
    brand,
    brandName: b.brandName,
    cloudUrl: cloudUrl(),
    iamUrl: trimSlash(process.env.NEXT_PUBLIC_IAM_URL ?? b.iamUrl),
    iamOrgName: process.env.NEXT_PUBLIC_IAM_ORG_NAME ?? b.iamOrgName,
    iamAppName: process.env.NEXT_PUBLIC_IAM_APP_NAME ?? b.iamApp,
    iamClientId: process.env.NEXT_PUBLIC_IAM_CLIENT_ID ?? b.iamApp,
    ...SHARED,
  }
  cache.set(brand, resolved)
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
