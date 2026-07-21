/**
 * Hostname-driven white-label brand registry — console's view of the shared
 * `@hanzo/brand` registry.
 *
 * The per-brand identity + mark geometry is NO LONGER defined here: it is the
 * fleet source `@hanzo/brand` (`@hanzo/brand/registry`, the pure-data subpath —
 * no React, no theme side-effect, safe in the admin-gate server route). This
 * module is now a thin ADAPTER that projects a `BrandIdentity` onto the console
 * `Brand` shape and keeps the console's own host resolution (`~/config`,
 * which owns the SSR default host + the IAM app wiring).
 *
 * Two orthogonal layers still stand: host → brand default (here), and the
 * per-org IAM logo override (`organization.logo`, in BrandLogo). White-label by
 * hostname — a lux/zoo/pars host NEVER renders the Hanzo mark.
 */
import { BRANDS as IDENTITIES, type BrandIdentity } from '@hanzo/brand/registry'

import { brandFromHost, config, type BrandId } from '~/config'

export type { BrandId }

export type Brand = {
  /** Stable id for the resolved brand — also the IAM org slug. */
  readonly id: BrandId
  /** Wordmark next to the mark (e.g. "Hanzo"). */
  readonly brandName: string
  /** Org/legal name (footers, copyright). */
  readonly orgName: string
  /** Primary marketing site. */
  readonly websiteUrl: string
  /** Email domain an operator must hold to reach this brand's admin console. */
  readonly adminDomain: string
  /** viewBox for the inline logo SVG. */
  readonly logoViewBox: string
  /** Inner SVG markup for the logo mark (multi-path; build-time-trusted constant). */
  readonly logoContent: string
}

/** Project a shared `BrandIdentity` onto the console `Brand` shape. */
function toConsoleBrand(b: BrandIdentity): Brand {
  return {
    id: b.id,
    brandName: b.name,
    orgName: b.legalName,
    websiteUrl: `https://${b.domain}`,
    adminDomain: b.adminDomain,
    logoViewBox: b.mark.viewBox,
    logoContent: b.mark.content,
  }
}

/** Every brand, keyed by id — adapted from the shared `@hanzo/brand` registry. */
export const BRANDS: Record<BrandId, Brand> = Object.fromEntries(
  Object.entries(IDENTITIES).map(([id, b]) => [id, toConsoleBrand(b)]),
) as Record<BrandId, Brand>

/**
 * Resolve the active brand. With an explicit `host` (server routes pass the
 * request Host header) it matches via `brandFromHost`; with no argument it uses
 * the runtime-resolved `config.brand` (window hostname in the browser). Host
 * matching stays in `~/config` (the console's one suffix table + SSR default).
 */
export function getBrand(host?: string | null): Brand {
  return BRANDS[host === undefined ? config.brand : brandFromHost(host)]
}
