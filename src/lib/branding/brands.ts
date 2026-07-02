/**
 * Hostname-driven white-label brand registry.
 *
 * ONE console image serves every brand: the request hostname selects the bundled
 * brand mark + names + admin domain. This is the DEFAULT brand layer; the per-org
 * IAM logo override (`organization.logo`) still sits ON TOP of it (two orthogonal
 * layers: host → brand default, org → custom-logo entitlement).
 *
 * DRY: host→brand resolution is NOT re-implemented here — it composes
 * `brandFromHost` from `~/config` (the single host-suffix table). The brand id is
 * also the IAM org slug (hanzo/lux/zoo/pars), so `adminDomain` + the org scope
 * both hang off this one record.
 *
 * Pure module (no React, no server-only imports) so it is safe in the server
 * routes (the admin gate) AND the client bundle (BrandLogo, the 403 panel). Logo
 * content uses `currentColor` (except the Zoo mark, which is intentionally
 * full-color) so the mark adapts to the dark/light theme with no per-theme asset.
 */
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

// Hanzo — the canonical blocky-"H" mark. Byte-identical geometry to
// `src/components/ui/HanzoMark.tsx` (5 paths, no opacity facets), so the default
// Hanzo render matches the existing chrome. Do not reintroduce a hand-drawn H.
const HANZO: Brand = {
  id: 'hanzo',
  brandName: 'Hanzo',
  orgName: 'Hanzo Industries Inc.',
  websiteUrl: 'https://hanzo.ai',
  adminDomain: 'hanzo.ai',
  logoViewBox: '0 0 67 67',
  logoContent:
    '<path d="M22.21 67V44.6369H0V67H22.21Z"/>' +
    '<path d="M66.7038 22.3184H22.2534L0.0878906 44.6367H44.4634L66.7038 22.3184Z"/>' +
    '<path d="M22.21 0H0V22.3184H22.21V0Z"/>' +
    '<path d="M66.7198 0H44.5098V22.3184H66.7198V0Z"/>' +
    '<path d="M66.7198 67V44.6369H44.5098V67H66.7198Z"/>',
}

// Lux — downward triangle (the explorer/console v1 registry mark, currentColor).
const LUX: Brand = {
  id: 'lux',
  brandName: 'Lux',
  orgName: 'Lux Industries Inc.',
  websiteUrl: 'https://lux.network',
  adminDomain: 'lux.network',
  logoViewBox: '0 0 100 100',
  logoContent: '<path d="M50 85 L15 25 L85 25 Z"/>',
}

// Zoo — interlocking circles (the explorer/console v1 registry mark; intentional
// full-color fills, not currentColor).
const ZOO: Brand = {
  id: 'zoo',
  brandName: 'Zoo',
  orgName: 'Zoo Labs Foundation',
  websiteUrl: 'https://zoo.ngo',
  adminDomain: 'zoo.ngo',
  logoViewBox: '0 0 1024 1024',
  logoContent:
    '<defs>' +
    '<clipPath id="zooClip"><circle cx="512" cy="511" r="270"/></clipPath>' +
    '<clipPath id="zooGClip"><circle cx="513" cy="369" r="234"/></clipPath>' +
    '<clipPath id="zooRClip"><circle cx="365" cy="595" r="234"/></clipPath>' +
    '</defs>' +
    '<g clip-path="url(#zooClip)">' +
    '<circle cx="513" cy="369" r="234" fill="#00A652"/>' +
    '<circle cx="365" cy="595" r="234" fill="#ED1C24"/>' +
    '<circle cx="643" cy="595" r="234" fill="#2E3192"/>' +
    '<g clip-path="url(#zooGClip)">' +
    '<circle cx="365" cy="595" r="234" fill="#FCF006"/>' +
    '<circle cx="643" cy="595" r="234" fill="#01ACF1"/>' +
    '</g>' +
    '<g clip-path="url(#zooRClip)">' +
    '<circle cx="643" cy="595" r="234" fill="#EA018E"/>' +
    '</g>' +
    '<g clip-path="url(#zooGClip)">' +
    '<g clip-path="url(#zooRClip)">' +
    '<circle cx="643" cy="595" r="234" fill="#FFFFFF"/>' +
    '</g></g></g>',
}

// Pars — Persian 8-pointed star (the explorer/console v1 registry mark).
const PARS: Brand = {
  id: 'pars',
  brandName: 'Pars',
  orgName: 'Parsis Foundation',
  websiteUrl: 'https://pars.network',
  adminDomain: 'pars.network',
  logoViewBox: '-120 -120 240 240',
  logoContent:
    '<path d="M0,-100 L30,-60 L100,-40 L60,0 L100,40 L30,60 L0,100 L-30,60 L-100,40 L-60,0 L-100,-40 L-30,-60 Z"' +
    ' fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/>' +
    '<path d="M0,-70 L22,-42 L70,-28 L42,0 L70,28 L22,42 L0,70 L-22,42 L-70,28 L-42,0 L-70,-28 L-22,-42 Z"' +
    ' fill="currentColor" fill-opacity="0.15" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/>' +
    '<circle r="55" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.4"/>' +
    '<circle r="35" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.4"/>' +
    '<circle r="8" fill="currentColor"/>',
}

// 7Stars — white-label Hanzo-cloud tenant (7stars.dev). No bespoke mark yet, so
// it falls back to the generic Hanzo blocky-H geometry (per the brand-asset
// fallback); its OWN name/org/website/adminDomain still apply. adminDomain is a
// security boundary (gateAllows requires an @7stars.dev admin email — matches the
// seeded owner z@7stars.dev). Swap logoContent when a real mark ships.
const SEVENSTARS: Brand = {
  id: '7stars',
  brandName: '7Stars',
  orgName: '7Stars',
  websiteUrl: 'https://7stars.dev',
  adminDomain: '7stars.dev',
  logoViewBox: HANZO.logoViewBox,
  logoContent: HANZO.logoContent,
}

// Yotoda — white-label Hanzo-cloud tenant (yotoda.tech). Same generic-mark
// fallback; own name/org/website/adminDomain (owner z@yotoda.tech → @yotoda.tech
// admin gate).
const YOTODA: Brand = {
  id: 'yotoda',
  brandName: 'Yotoda',
  orgName: 'Yotoda',
  websiteUrl: 'https://yotoda.tech',
  adminDomain: 'yotoda.tech',
  logoViewBox: HANZO.logoViewBox,
  logoContent: HANZO.logoContent,
}

/** Every brand, keyed by id. The brand id is also the IAM org slug. */
export const BRANDS: Record<BrandId, Brand> = {
  hanzo: HANZO,
  lux: LUX,
  zoo: ZOO,
  pars: PARS,
  '7stars': SEVENSTARS,
  yotoda: YOTODA,
}

/**
 * Resolve the active brand. With an explicit `host` (server routes pass the
 * request Host header) it matches via `brandFromHost`; with no argument it uses
 * the runtime-resolved `config.brand` (window hostname in the browser). Host
 * matching is never re-implemented here — `~/config` owns the one suffix table.
 */
export function getBrand(host?: string | null): Brand {
  return BRANDS[host === undefined ? config.brand : brandFromHost(host)]
}
