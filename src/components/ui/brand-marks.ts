/**
 * Per-family model brand MARKS — the ONE map that gives every model family its own
 * distinct, recognizable glyph (not a colored letter, not a generic circle). Keyed
 * by the canonical `BrandKey` (`./brand`), consumed ONLY by `ProviderLogo`, so every
 * surface that renders a family/provider avatar (the Models catalog family headers +
 * rows, the playground ModelPicker rail + rows, Marketplace, Provider admin,
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
 * Brand policy (repo LLM.md): **Zen is the house brand** and renders the Hanzo mark
 * (handled in `ProviderLogo`, not here) — it NEVER carries an upstream family glyph.
 * The third-party families below are the real open-weight brands we resell by name,
 * so an evocative mark for each is on-brand and honest.
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
  // Google Gemma — a faceted gem (Gemma = gem), the cut-diamond silhouette + facets.
  google: {
    viewBox: '0 0 24 24',
    body:
      '<g fill="none" stroke="currentColor" stroke-width="1.55" stroke-linejoin="round">' +
      '<path d="M7.5 4h9l3.5 5-8 11-8-11Z"/>' +
      '<path d="M4 9h16"/>' +
      '<path d="M9.5 4 12 9M14.5 4 12 9M12 9v11"/>' +
      '</g>',
  },
  // OpenAI GPT-OSS — a six-point knot/asterisk (its hexagonal-knot mark, simplified).
  openai: {
    viewBox: '0 0 24 24',
    body:
      '<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">' +
      '<path d="M12 3.4v17.2M4.55 7.7 19.45 16.3M4.55 16.3 19.45 7.7"/>' +
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
}
