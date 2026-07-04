/**
 * White-label PACKAGE model — the TYPE + pure helpers + normalizer for a package
 * record. The catalog itself is DATA, NOT code: package records live in the platform
 * (`GET /v1/packages`, read via `PackagesApi` over the /paas proxy), seeded from
 * `platform-seed/packages.json`. Adding a package = a platform DB row + reseed, never
 * a console code edit + redeploy. This file holds ONLY the shape the console renders
 * and the pure logic over it — no hardcoded catalog.
 *
 * A PACKAGE is a named preset of Hanzo services provisioned together for a tenant
 * org, with a brand template, an IAM template (org+app, optionally its own issuer),
 * a domain pattern, and a default plan.
 */

/** A single Hanzo service a package can bundle. The id matches the operator service
 *  / product surface it deploys, so a package's `services` is checkable against the
 *  real apps inventory (`GET /v1/apps`). */
export type PackageService =
  | 'console-admin' // the white-label admin console itself (this app), per-tenant host
  | 'paas' // the deploy platform (projects/apps/environments)
  | 'iam' // identity — the tenant's own org + app scope
  | 'kms' // per-tenant secret management
  | 'dex' // decentralized exchange surface
  | 'bank' // the regulated bank/tokenization stack
  | 'ats' // alternative trading system
  | 'bd' // broker-dealer
  | 'ta' // transfer agent
  | 'chain' // a sovereign L1 (the tenant's own EVM/primary network)

/** The default billing plan a package provisions the tenant on. */
export type PackagePlan = 'pay-as-you-go' | 'starter' | 'growth' | 'enterprise'

/**
 * The BRAND template a package seeds — the per-tenant look (logo/favicon/host).
 * These are TEMPLATE defaults the operator overrides per tenant in the brand panel;
 * they are never fabricated onto a tenant that hasn't been branded.
 */
export type BrandTemplate = {
  /** Whether this package expects a fully custom brand (logo + favicon + own host). */
  customBrand: boolean
  /** The default host PATTERN, `{slug}` substituted with the tenant slug at bind time
   *  (e.g. `{slug}.hanzo.app`). The operator can bind any custom domain instead. */
  hostPattern: string
}

/**
 * The IAM template a package seeds — the tenant's identity scope.
 * `ownIssuer` means the tenant gets its OWN OIDC issuer (e.g. `lux.id`) rather than
 * sharing the brand issuer; `appPattern` is the `<org>-<app>` client id convention.
 */
export type IamTemplate = {
  /** The tenant runs its own OIDC issuer (own-brand login) vs. the shared brand IAM. */
  ownIssuer: boolean
  /** The `<org>-<app>` client-id pattern, `{slug}` = tenant slug (e.g. `{slug}-console`). */
  appPattern: string
}

/** One package record — as the platform serves it (`GET /v1/packages`). */
export type Package = {
  /** Stable id (kebab). */
  id: string
  /** Display name. */
  name: string
  /** One-line description for the catalog card. */
  description: string
  /** The bundled services provisioned together. */
  services: PackageService[]
  /** The brand template seeded on grant. */
  brandTemplate: BrandTemplate
  /** The IAM template seeded on grant. */
  iamTemplate: IamTemplate
  /** The default host pattern (mirrors `brandTemplate.hostPattern`; `{slug}` filled at bind). */
  domainPattern: string
  /** The default plan the tenant is provisioned on. */
  plan: PackagePlan
  /** A sovereign-L1 bundle (its own chain) — flagged so the UI can badge it. */
  sovereign?: boolean
}

// ── pure helpers over a package record (no catalog, no network) ──────────────

const VALID_SERVICES: readonly PackageService[] = [
  'console-admin', 'paas', 'iam', 'kms', 'dex', 'bank', 'ats', 'bd', 'ta', 'chain',
]
const VALID_PLANS: readonly PackagePlan[] = ['pay-as-you-go', 'starter', 'growth', 'enterprise']

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const bool = (v: unknown): boolean => v === true

/**
 * Normalize ONE raw package record (from the platform API or the seed JSON) into a
 * typed `Package`. Optional-safe: unknown services are dropped, a bad plan falls back
 * to pay-as-you-go — never throws, never fabricates. Returns null when the record has
 * no id (unusable), so the caller can filter it out honestly.
 */
export function normalizePackage(raw: unknown): Package | null {
  const r = (raw ?? {}) as Record<string, unknown>
  const id = str(r.id)
  if (!id) return null
  const bt = (r.brandTemplate ?? {}) as Record<string, unknown>
  const it = (r.iamTemplate ?? {}) as Record<string, unknown>
  const services = (Array.isArray(r.services) ? r.services : [])
    .map(str)
    .filter((s): s is PackageService => (VALID_SERVICES as readonly string[]).includes(s))
  const plan = (VALID_PLANS as readonly string[]).includes(str(r.plan)) ? (str(r.plan) as PackagePlan) : 'pay-as-you-go'
  const domainPattern = str(r.domainPattern) || str(bt.hostPattern)
  return {
    id,
    name: str(r.name) || id,
    description: str(r.description),
    services,
    brandTemplate: { customBrand: bool(bt.customBrand), hostPattern: str(bt.hostPattern) || domainPattern },
    iamTemplate: { ownIssuer: bool(it.ownIssuer), appPattern: str(it.appPattern) || '{slug}' },
    domainPattern,
    plan,
    sovereign: bool(r.sovereign) || undefined,
  }
}

/** Normalize a raw package LIST (bare array or `{packages:[…]}` / `{data:[…]}`). Honest empty. */
export function normalizePackages(raw: unknown): Package[] {
  const rows = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object'
      ? ((raw as Record<string, unknown>).packages as unknown[]) ??
        ((raw as Record<string, unknown>).data as unknown[]) ??
        []
      : []
  return (Array.isArray(rows) ? rows : []).map(normalizePackage).filter((p): p is Package => p !== null)
}

/** One package by id from a list, or undefined. Never throws (honest lookup). */
export function packageById(packages: Package[], id: string): Package | undefined {
  return packages.find((p) => p.id === id)
}

/**
 * Substitute `{slug}` in a host/app pattern with the tenant slug. A blank slug is
 * left as the literal `{slug}` token so the UI never renders a broken host like
 * `console..hanzo.app` — it shows the honest pattern until a slug exists.
 */
export function fillPattern(pattern: string, slug: string): string {
  const s = slug.trim()
  return s ? pattern.replaceAll('{slug}', s) : pattern
}

/** The concrete default host a package would bind for a tenant slug. */
export function packageHost(pkg: Package, slug: string): string {
  return fillPattern(pkg.domainPattern, slug)
}

/** The concrete IAM client id a package would create for a tenant slug. */
export function packageAppId(pkg: Package, slug: string): string {
  return fillPattern(pkg.iamTemplate.appPattern, slug)
}

/** Human label for a bundled service (for chips in the catalog card). */
export const SERVICE_LABELS: Record<PackageService, string> = {
  'console-admin': 'Console',
  paas: 'PaaS',
  iam: 'IAM',
  kms: 'KMS',
  dex: 'DEX',
  bank: 'Bank',
  ats: 'ATS',
  bd: 'BD',
  ta: 'TA',
  chain: 'Chain',
}
