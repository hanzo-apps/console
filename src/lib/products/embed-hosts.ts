/**
 * White-label host derivation for the console's EMBEDDED canonical apps — the
 * Content Studio (Payload CMS), ERP (ERPNext/Frappe), and the Help Center (Frappe
 * Helpdesk). Each of these is a REAL Hanzo product served on its own subdomain of
 * the current brand's domain, embedded IN the console shell (not a link-out).
 *
 * The console is one image serving every brand (cloud.hanzo.ai → hanzo,
 * cloud.lux.cloud → lux). An embedded app must resolve to ITS OWN brand's host, so
 * a Lux/Zoo console never frames Hanzo's Studio. The rule is purely host-derived:
 * drop the leading service label (`console`/`cloud`/`admin`/…) to get the brand's
 * registrable domain, then prefix the target service label (`cms`/`erp`/`help`).
 * PURE + unit-tested (embed-hosts.test.ts) — no window access here; the caller
 * passes the current host (`currentHost()`), so it is SSR-safe and testable.
 *
 * Tenancy is NOT encoded in the host: these apps are SINGLE shared per-BRAND
 * instances (verified — NOT per-customer-org). So the host is per-BRAND, and the
 * console decides WHO may frame it via a server-side entitlement gate
 * (`/embed-status` + `embed-probe.ts`: brand-org member / global admin only) — a
 * customer org gets a provision panel, never a cross-tenant frame. This module only
 * derives the per-brand host; it makes NO isolation claim about the backing app.
 */

/** The brand domain used when the host can't be parsed (dev/localhost/IP). */
export const EMBED_FALLBACK_DOMAIN = 'hanzo.ai'

/**
 * The registrable brand domain for a console host: everything after the first
 * label. `console.hanzo.ai` → `hanzo.ai`, `cloud.lux.cloud` → `lux.cloud`,
 * `admin.zoo.cloud` → `zoo.cloud`. A bare apex (`hanzo.ai`) is returned as-is; a
 * single-label host (`localhost`) or an IPv4 literal falls back to the brand
 * default. A port is stripped. PURE.
 */
export function brandDomain(host: string | null | undefined, fallback: string = EMBED_FALLBACK_DOMAIN): string {
  const h = (host ?? '').split(':')[0].trim().toLowerCase()
  if (!h) return fallback
  // An IPv4 literal has no registrable domain — fall back to the brand default.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return fallback
  const parts = h.split('.').filter(Boolean)
  if (parts.length >= 3) return parts.slice(1).join('.') // sub.example.com → example.com
  if (parts.length === 2) return parts.join('.') // example.com (already the apex)
  return fallback // single label (localhost) / empty
}

/**
 * The HTTPS origin of a brand service for the given console host, e.g.
 * `serviceOrigin('cms', 'console.hanzo.ai')` → `https://cms.hanzo.ai`. The service
 * label is lower-cased; the brand domain is derived by `brandDomain`.
 */
export function serviceOrigin(
  service: string,
  host: string | null | undefined,
  fallback: string = EMBED_FALLBACK_DOMAIN,
): string {
  return `https://${service.trim().toLowerCase()}.${brandDomain(host, fallback)}`
}

/** The Content Studio (Payload CMS) origin for this brand — `cms.<brand-domain>`. */
export const studioOrigin = (host?: string | null): string => serviceOrigin('cms', host)

/** The ERP (ERPNext/Frappe) origin for this brand — `erp.<brand-domain>`. */
export const erpOrigin = (host?: string | null): string => serviceOrigin('erp', host)

/** The Help Center (Frappe Helpdesk) origin for this brand — `help.<brand-domain>`. */
export const helpOrigin = (host?: string | null): string => serviceOrigin('help', host)

/** The current browser host, or null on the server (so callers stay SSR-safe). */
export function currentHost(): string | null {
  return typeof window === 'undefined' ? null : window.location.hostname
}
