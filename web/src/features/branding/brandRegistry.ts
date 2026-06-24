/**
 * Hostname-driven white-label brand registry.
 *
 * One console image serves every brand: the request hostname selects the
 * bundled brand defaults (logo mark + names), and every field is overridable at
 * deploy time via NEXT_PUBLIC_BRAND* env vars. Mirrors the proven explorer model
 * (`luxfi/explore` configs/app/chainRegistry.ts) — one source of truth, brand by
 * host, no per-deployment fork.
 *
 * This is the DEFAULT brand layer. The per-org logo override
 * (`useUiCustomization` image URLs) still sits ON TOP of it — two orthogonal
 * layers: host -> brand (default), org -> custom logo (entitlement override).
 *
 * Pure module (no React, no server-only imports) so it is safe in both SSR and
 * client bundles. Logo content uses `currentColor` so it adapts to the theme.
 */

export type BrandId = "hanzo" | "lux" | "zoo" | "pars";

export interface Brand {
  /** Stable id for the resolved brand. */
  readonly id: BrandId;
  /** Wordmark next to the logo (e.g. "Hanzo"). */
  readonly brandName: string;
  /** Org/legal name (footers, copyright). */
  readonly orgName: string;
  /** Primary marketing site. */
  readonly websiteUrl: string;
  /** viewBox for the inline logo SVG. */
  readonly logoViewBox: string;
  /** Inner SVG markup for the logo mark (multi-path, uses currentColor). */
  readonly logoContent: string;
}

// Hanzo — the canonical monochrome "blocky-H" mark (7 paths incl. the two
// opacity-0.8 shadow facets). Byte-identical to the existing HanzoCloudIcon so
// the default Hanzo render is unchanged. Do not reintroduce a hand-drawn H.
const HANZO_BRAND: Brand = {
  id: "hanzo",
  brandName: "Hanzo",
  orgName: "Hanzo Industries Inc.",
  websiteUrl: "https://hanzo.ai",
  logoViewBox: "0 0 67 67",
  logoContent:
    '<path d="M22.21 67V44.6369H0V67H22.21Z"/>' +
    '<path d="M0 44.6369L22.21 46.8285V44.6369H0Z" opacity="0.8"/>' +
    '<path d="M66.7038 22.3184H22.2534L0.0878906 44.6367H44.4634L66.7038 22.3184Z"/>' +
    '<path d="M22.21 0H0V22.3184H22.21V0Z"/>' +
    '<path d="M66.7198 0H44.5098V22.3184H66.7198V0Z"/>' +
    '<path d="M66.6753 22.3185L44.5098 20.0822V22.3185H66.6753Z" opacity="0.8"/>' +
    '<path d="M66.7198 67V44.6369H44.5098V67H66.7198Z"/>',
};

// Lux — downward triangle (lifted from the explorer registry).
const LUX_BRAND: Brand = {
  id: "lux",
  brandName: "Lux",
  orgName: "Lux Industries Inc.",
  websiteUrl: "https://lux.network",
  logoViewBox: "0 0 100 100",
  logoContent: '<path d="M50 85 L15 25 L85 25 Z"/>',
};

// Zoo — colorful interlocking circles (lifted from the explorer registry;
// uses explicit fills, not currentColor, by design).
const ZOO_BRAND: Brand = {
  id: "zoo",
  brandName: "Zoo",
  orgName: "Zoo Labs Foundation",
  websiteUrl: "https://zoo.ngo",
  logoViewBox: "0 0 1024 1024",
  logoContent:
    "<defs>" +
    '<clipPath id="zooClip"><circle cx="512" cy="511" r="270"/></clipPath>' +
    '<clipPath id="zooGClip"><circle cx="513" cy="369" r="234"/></clipPath>' +
    '<clipPath id="zooRClip"><circle cx="365" cy="595" r="234"/></clipPath>' +
    "</defs>" +
    '<g clip-path="url(#zooClip)">' +
    '<circle cx="513" cy="369" r="234" fill="#00A652"/>' +
    '<circle cx="365" cy="595" r="234" fill="#ED1C24"/>' +
    '<circle cx="643" cy="595" r="234" fill="#2E3192"/>' +
    '<g clip-path="url(#zooGClip)">' +
    '<circle cx="365" cy="595" r="234" fill="#FCF006"/>' +
    '<circle cx="643" cy="595" r="234" fill="#01ACF1"/>' +
    "</g>" +
    '<g clip-path="url(#zooRClip)">' +
    '<circle cx="643" cy="595" r="234" fill="#EA018E"/>' +
    "</g>" +
    '<g clip-path="url(#zooGClip)">' +
    '<g clip-path="url(#zooRClip)">' +
    '<circle cx="643" cy="595" r="234" fill="#FFFFFF"/>' +
    "</g></g></g>",
};

// Pars — Persian 8-pointed star (lifted from the explorer registry).
const PARS_BRAND: Brand = {
  id: "pars",
  brandName: "Pars",
  orgName: "Parsis Foundation",
  websiteUrl: "https://pars.network",
  logoViewBox: "-120 -120 240 240",
  logoContent:
    '<path d="M0,-100 L30,-60 L100,-40 L60,0 L100,40 L30,60 L0,100 L-30,60 L-100,40 L-60,0 L-100,-40 L-30,-60 Z"' +
    ' fill="none" stroke="currentColor" stroke-width="4" stroke-linejoin="round"/>' +
    '<path d="M0,-70 L22,-42 L70,-28 L42,0 L70,28 L22,42 L0,70 L-22,42 L-70,28 L-42,0 L-70,-28 L-22,-42 Z"' +
    ' fill="currentColor" fill-opacity="0.15" stroke="currentColor" stroke-width="3" stroke-linejoin="round"/>' +
    '<circle r="55" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.4"/>' +
    '<circle r="35" fill="none" stroke="currentColor" stroke-width="1.5" opacity="0.4"/>' +
    '<circle r="8" fill="currentColor"/>',
};

export const BRANDS: Record<BrandId, Brand> = {
  hanzo: HANZO_BRAND,
  lux: LUX_BRAND,
  zoo: ZOO_BRAND,
  pars: PARS_BRAND,
};

export const DEFAULT_BRAND: Brand = HANZO_BRAND;

/**
 * Hostname suffix -> brand. Longest/most-specific match wins. Covers both the
 * canonical `console.<brand>.<tld>` hosts and the brand apex. Add a partner host
 * here (or set NEXT_PUBLIC_BRAND at deploy) to white-label it.
 */
const HOSTNAME_SUFFIXES: ReadonlyArray<{ suffix: string; brand: BrandId }> = [
  { suffix: "hanzo.ai", brand: "hanzo" },
  { suffix: "hanzo.network", brand: "hanzo" },
  { suffix: "lux.network", brand: "lux" },
  { suffix: "lux.build", brand: "lux" },
  { suffix: "zoo.ngo", brand: "zoo" },
  { suffix: "zoo.network", brand: "zoo" },
  { suffix: "pars.network", brand: "pars" },
  { suffix: "pars.vote", brand: "pars" },
];

function normalizeBrandId(value: string | undefined | null): BrandId | null {
  if (!value) return null;
  const v = value.trim().toLowerCase();
  return v === "hanzo" || v === "lux" || v === "zoo" || v === "pars" ? v : null;
}

/**
 * Apply NEXT_PUBLIC_BRAND_* overrides on top of a resolved brand so operators
 * can rebrand any field at deploy time without a code change. Reads
 * process.env directly (NEXT_PUBLIC_* values are inlined at build time and also
 * present at runtime in the Node server), mirroring the explorer's override.
 */
function applyBrandEnvOverrides(brand: Brand): Brand {
  const e = process.env;
  const next: Brand = {
    ...brand,
    brandName: e.NEXT_PUBLIC_BRAND_NAME?.trim() || brand.brandName,
    orgName: e.NEXT_PUBLIC_BRAND_ORG_NAME?.trim() || brand.orgName,
    websiteUrl: e.NEXT_PUBLIC_BRAND_WEBSITE_URL?.trim() || brand.websiteUrl,
    logoViewBox: e.NEXT_PUBLIC_BRAND_LOGO_VIEWBOX?.trim() || brand.logoViewBox,
    logoContent: e.NEXT_PUBLIC_BRAND_LOGO_CONTENT?.trim() || brand.logoContent,
  };
  return next;
}

/**
 * Resolve the active brand. Precedence:
 *   1. explicit NEXT_PUBLIC_BRAND env (operator pin) — wins everywhere
 *   2. request hostname suffix match
 *   3. default (Hanzo)
 * Then deploy-time NEXT_PUBLIC_BRAND_* field overrides are layered on top.
 *
 * `host` should be the request host (server: x-forwarded-host/host header;
 * client: window.location.hostname). Port and case are ignored.
 */
export function getBrandFromHost(host?: string | null): Brand {
  const envBrand = normalizeBrandId(process.env.NEXT_PUBLIC_BRAND);
  if (envBrand) return applyBrandEnvOverrides(BRANDS[envBrand]);

  const hostname = (host ?? "").toLowerCase().replace(/:\d+$/, "").trim();
  if (hostname) {
    let match: { suffix: string; brand: BrandId } | undefined;
    for (const entry of HOSTNAME_SUFFIXES) {
      if (hostname === entry.suffix || hostname.endsWith("." + entry.suffix)) {
        if (!match || entry.suffix.length > match.suffix.length) match = entry;
      }
    }
    if (match) return applyBrandEnvOverrides(BRANDS[match.brand]);
  }

  return applyBrandEnvOverrides(DEFAULT_BRAND);
}
