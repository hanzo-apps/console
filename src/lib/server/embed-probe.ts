/**
 * Pure logic for the `/embed-status` reachability probe (SSRF clamp + liveness
 * classifier + per-app landing path). Extracted from the route so the
 * security-critical clamp is unit-tested in isolation, with no server deps.
 *
 * The clamp is the SSRF control: the probe target is ALWAYS `<app>.<known brand
 * domain>`. A forged Host header that derives to an unknown domain falls back to
 * the hanzo brand default, so this can never be steered to fetch an attacker host.
 */
import { brandDomain } from '~/lib/products/embed-hosts'

/** The registrable domains of the real brands this one console image serves. */
export const KNOWN_BRAND_DOMAINS = new Set(['hanzo.ai', 'lux.cloud', 'zoo.cloud', 'pars.cloud'])
export const DEFAULT_BRAND_DOMAIN = 'hanzo.ai'

/** The apps this route resolves, and the in-app landing path each embeds. */
export const EMBED_APPS = {
  cms: '/admin', // Payload admin
  erp: '/app', // ERPNext desk
  help: '/helpdesk', // Frappe Helpdesk
} as const
export type EmbedAppId = keyof typeof EMBED_APPS

/** True iff `x` names an app this route can resolve. */
export function isEmbedApp(x: string): x is EmbedAppId {
  return Object.prototype.hasOwnProperty.call(EMBED_APPS, x)
}

/** The brand domain for a host, CLAMPED to a known brand (SSRF-safe fallback). */
export function clampedBrandDomain(host: string | null | undefined): string {
  const d = brandDomain(host, DEFAULT_BRAND_DOMAIN)
  return KNOWN_BRAND_DOMAINS.has(d) ? d : DEFAULT_BRAND_DOMAIN
}

/** The clamped brand origin for an app + host, e.g. `https://cms.hanzo.ai`. */
export function embedOrigin(app: EmbedAppId, host: string | null | undefined): string {
  return `https://${app}.${clampedBrandDomain(host)}`
}

/** The origin + full embed URL (origin + the app's landing path) for an app + host. */
export function embedTarget(app: EmbedAppId, host: string | null | undefined): { origin: string; embedUrl: string } {
  const origin = embedOrigin(app, host)
  return { origin, embedUrl: `${origin}${EMBED_APPS[app]}` }
}

/**
 * Classify a probe response as "app is up". Up = a 2xx/3xx (landing or SSO
 * redirect) or an app-level 401/403 (running, wants login). Down = 404 (no such
 * app on that host) or any 5xx (502/503/504 — the unprovisioned state); a
 * network/timeout error is handled by the caller as down.
 */
export function isUp(status: number): boolean {
  if (status >= 500) return false
  if (status === 404) return false
  return status > 0
}

/** The IAM org that OWNS each brand's shared app instances (single-tenant today). */
export const BRAND_DOMAIN_TO_ORG: Record<string, string> = {
  'hanzo.ai': 'hanzo',
  'lux.cloud': 'lux',
  'zoo.cloud': 'zoo',
  'pars.cloud': 'pars',
}

/** The brand-owning IAM org for a console host (clamped), e.g. console.hanzo.ai → 'hanzo'. */
export function brandOrgForHost(host: string | null | undefined): string {
  return BRAND_DOMAIN_TO_ORG[clampedBrandDomain(host)] ?? 'hanzo'
}

/**
 * Ownership model per app — VERIFIED ground truth, not aspiration: cms/erp/help are
 * each a SINGLE shared per-BRAND instance (`HANZO_ORG=hanzo`, one store), NOT a
 * per-customer-org instance. So only a member of the owning BRAND org (or a global
 * admin) may frame them — embedding a brand's shared Studio/ERP/Helpdesk for a
 * CUSTOMER org would expose the brand's content/tickets (cross-tenant). A customer
 * org gets an honest provision panel instead.
 */
export const EMBED_OWNERSHIP: Record<EmbedAppId, 'brand'> = {
  cms: 'brand',
  erp: 'brand',
  help: 'brand',
}

/**
 * Is the caller ENTITLED to embed this app? The SERVER-SIDE gate (defense beyond the
 * cosmetic client check): a 'brand'-owned app embeds only for a member of the owning
 * brand org or a global admin. A non-entitled caller NEVER receives the embed URL —
 * the route returns entitled:false and the module shows the provision panel. The org
 * is the token owner (server-resolved), never a browser claim.
 */
export function isEntitled(app: EmbedAppId, callerOrg: string, brandOrg: string, isGlobalAdmin: boolean): boolean {
  // EMBED_OWNERSHIP[app] is 'brand' for every app today; the guard keeps the door
  // open for a future genuinely-shared app without changing callers.
  if (EMBED_OWNERSHIP[app] !== 'brand') return true
  return (callerOrg !== '' && callerOrg === brandOrg) || isGlobalAdmin === true
}
