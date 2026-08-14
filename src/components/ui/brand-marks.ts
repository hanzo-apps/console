/**
 * Per-family model brand MARKS — the ONE map that gives every model family its own
 * distinct, recognizable glyph (not a colored letter, not a generic circle). Keyed
 * by the canonical `BrandKey` (`./brand`), consumed ONLY by `ProviderLogo`, so every
 * surface that renders a family/provider avatar (the Models catalog family headers +
 * rows, the unified ModelSelector family headers + rows, Marketplace, Provider admin,
 * Providers explore) gets the same marks for free. DRY: one family → one mark.
 *
 * Each mark is our OWN simple, tasteful, monochrome inline SVG — an avatar that
 * EVOKES the family (paired with the brand hue in `./brand` `BRANDS`), NOT a copy of
 * a trademark logo file and never an external hotlink. `currentColor` throughout so
 * the caller controls the fill (knocked out white on the brand-colored tile, exactly
 * like the first-party Hanzo mark), and it adapts to the theme with no per-theme
 * asset. The body is a build-time-trusted constant (never user input), so inlining it
 * via `dangerouslySetInnerHTML` is safe — the same pattern as `BrandLogo`/`brands.ts`.
 *
 * Brand policy: a mark names the MAKER. Zen is made by Zoo Labs, so it carries Zoo's
 * trefoil here rather than the Hanzo block-H — Hanzo serves Zen, it does not build it,
 * and a logo that says otherwise misattributes someone else's work. `hanzo` and `enso`
 * are Hanzo's own and still render the block-H from `ProviderLogo`.
 * The brands below are the real model VENDORS the api.hanzo.ai gateway serves —
 * open-weight families (Qwen/Meta/DeepSeek/Mistral) AND the proprietary vendors it
 * proxies (OpenAI/Anthropic/Google Gemini/xAI) — so an evocative mark for each is the
 * MODEL VENDOR's brand (shown on every white-label host), distinct from the platform
 * brand, and stays honest.
 */
import type { BrandKey } from './brand'

/** One mark: its viewBox + the inner SVG markup (uses `currentColor`). */
export type BrandMark = {
  readonly viewBox: string
  /** Inner SVG (paths/strokes) — a build-time constant, `currentColor` only. */
  readonly body: string
}

// Distinct, recognizable marks for the curated third-party model families the
// gateway serves. Each is visually distinct from the others AND from the first-party
// Hanzo block-H, so no two families ever read as the same glyph.
export const BRAND_MARK: Partial<Record<BrandKey, BrandMark>> = {
  // Zen (Zoo Labs) — the trefoil: three equal rings overlapping at the centre, the
  // additive colour-mixing mark Zoo builds its identity on (@zooai/logo draws it in
  // green/red/blue; monochrome here, like every other mark on this map).
  zen: {
    viewBox: '0 0 24 24',
    body:
      '<g fill="none" stroke="currentColor" stroke-width="1.6">' +
      '<circle cx="12" cy="9.2" r="4.4"/>' +
      '<circle cx="9.1" cy="14.2" r="4.4"/>' +
      '<circle cx="14.9" cy="14.2" r="4.4"/>' +
      '</g>',
  },
  // Anthropic (Claude) — the sunburst/spark: tapered rays radiating from a center,
  // its signature radial burst mark (knocked out white on the coral tile).
  anthropic: {
    viewBox: '0 0 24 24',
    body:
      '<g stroke="currentColor" stroke-width="1.7" stroke-linecap="round">' +
      '<path d="M12 3v18"/><path d="M3 12h18"/>' +
      '<path d="M4.2 7.5 19.8 16.5"/><path d="M4.2 16.5 19.8 7.5"/>' +
      '<path d="M7.5 4.2 16.5 19.8"/><path d="M16.5 4.2 7.5 19.8"/>' +
      '</g>',
  },
  // Qwen — a geometric origami hexagon with a Y-fold (its angular, folded mark).
  qwen: {
    viewBox: '0 0 24 24',
    body:
      '<path d="M12 2.6 20.1 7.3v9.4L12 21.4 3.9 16.7V7.3Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>' +
      '<path d="M12 12V2.6M12 12l8.1 4.7M12 12l-8.1 4.7" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round"/>',
  },
  // DeepSeek — a leaping whale (its signature cetacean mark): rounded body, fluke, spout.
  deepseek: {
    viewBox: '0 0 24 24',
    body:
      '<path d="M3.4 12.4c0-3.7 3-6.5 6.9-6.5 3.6 0 6.5 2.6 6.5 6.1 0 3.7-3 6.2-6.9 6.2-1.4 0-2.8-.4-3.9-1.1-1.5.6-2.8.4-2.8.4s.8-1 .6-2.3c-.9-.9-1.4-1.8-1.4-2.8Z" fill="currentColor"/>' +
      '<path d="M15.9 11.2 21.5 8v8l-5.6-3.1Z" fill="currentColor"/>' +
      '<path d="M8.4 6c1.1-1.4 1.2-3 .5-4.4" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>',
  },
  // Meta — the infinity ribbon (its lemniscate mark), a single continuous stroke.
  meta: {
    viewBox: '0 0 24 24',
    body:
      '<path d="M3 12c0-2.2 1.6-3.8 3.6-3.8 1.9 0 3.3 1.4 5.4 3.8 2.1 2.4 3.5 3.8 5.4 3.8 2 0 3.6-1.6 3.6-3.8s-1.6-3.8-3.6-3.8c-1.9 0-3.3 1.4-5.4 3.8C10.3 14.4 8.9 15.8 7 15.8 5 15.8 3 14.2 3 12Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  },
  // Mistral — a bold, blocky "M" (its gridded-M wordmark, monochrome).
  mistral: {
    viewBox: '0 0 24 24',
    body:
      '<path d="M3 20V5.4h3.3L12 12.9l5.7-7.5H21V20h-3.4v-8.6L12 18.9 6.4 11.4V20Z" fill="currentColor"/>',
  },
  // Google Gemini — the four-point spark star (concave-sided), Gemini's signature
  // glyph. Covers the Google family (Gemini + the Gemma slice) as one Google-AI mark.
  google: {
    viewBox: '0 0 24 24',
    body:
      '<path d="M12 2C12.6 7.2 16.8 11.4 22 12 16.8 12.6 12.6 16.8 12 22 11.4 16.8 7.2 12.6 2 12 7.2 11.4 11.4 7.2 12 2Z" fill="currentColor"/>',
  },
  // OpenAI — the blossom knot: three interlocking loops forming its six-fold hexagonal
  // rosette (three rotated ellipse outlines), its signature flower mark.
  openai: {
    viewBox: '0 0 24 24',
    body:
      '<g fill="none" stroke="currentColor" stroke-width="1.5">' +
      '<ellipse cx="12" cy="12" rx="3.4" ry="8.2"/>' +
      '<ellipse cx="12" cy="12" rx="3.4" ry="8.2" transform="rotate(60 12 12)"/>' +
      '<ellipse cx="12" cy="12" rx="3.4" ry="8.2" transform="rotate(120 12 12)"/>' +
      '</g>',
  },
  // xAI — a bold "X" (its wordless mark). Appears in the broader provider picker.
  xai: {
    viewBox: '0 0 24 24',
    body:
      '<path d="M4.5 4.5 19.5 19.5M19.5 4.5 4.5 19.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>',
  },
  // Moonshot / Kimi — a crescent moon (its lunar mark). Provider picker surfaces.
  moonshot: {
    viewBox: '0 0 24 24',
    body:
      '<path d="M20 14.5A8.5 8.5 0 1 1 11.5 4a6.7 6.7 0 0 0 8.5 10.5Z" fill="currentColor"/>',
  },
  // NVIDIA — a stylized eye/spiral (its "eye" mark), one continuous stroke.
  nvidia: {
    viewBox: '0 0 24 24',
    body:
      '<path d="M3 12s3.5-5 9-5 9 5 9 5-3.5 5-9 5-9-5-9-5Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>' +
      '<circle cx="12" cy="12" r="2.4" fill="currentColor"/>',
  },
  // Zhipu (GLM) — a node triad: three linked vertices, evoking the graph/relational
  // model family. Distinct from every other mark (a connected-node triangle).
  zhipu: {
    viewBox: '0 0 24 24',
    body:
      '<path d="M12 5 5.5 16.5H18.5Z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>' +
      '<circle cx="12" cy="5" r="2.3" fill="currentColor"/>' +
      '<circle cx="5.5" cy="16.5" r="2.3" fill="currentColor"/>' +
      '<circle cx="18.5" cy="16.5" r="2.3" fill="currentColor"/>',
  },
  // MiniMax — a min bar beside a max bar (a short rounded column next to a tall one),
  // its literal "min/max" mark. Distinct blocky pair.
  minimax: {
    viewBox: '0 0 24 24',
    body:
      '<g fill="currentColor">' +
      '<rect x="5" y="12" width="4.4" height="7.5" rx="2.2"/>' +
      '<rect x="14.6" y="4.5" width="4.4" height="15" rx="2.2"/>' +
      '</g>',
  },
}
