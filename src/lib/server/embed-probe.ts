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
