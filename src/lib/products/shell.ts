// The product-shell descriptor — the ONE source of truth for each console FACE.
// Pure + dependency-free (the `ShellId` import is type-only, erased at compile), so
// the shell contract is unit-testable in isolation (shell.test.ts) without the React
// registry or a hostname — a value, not a place, exactly like `brand-scope.ts`.
//
// A product shell scopes the SAME console image to one product: `billing` is the
// Billing-Center-only portal (billing.<brand>), `sentry` is the Sentry error/log/
// trace face (sentry.<brand>). Both are ONE module whose declared sub-pages ARE the
// shell's nav — so the shell chrome (Dashboard) renders them through the SAME
// nav branch, driven by this descriptor. `console` is the full catalog (no scope).
import type { ShellId } from '~/config'

export type ProductShell = {
  id: ShellId
  /**
   * The catalog module id the shell surfaces — its declared sub-pages become the
   * nav (Overview + specifics). `null` for the full console (no single root).
   */
  rootId: string | null
  /** Label for the module's index ('') sub-page in the shell nav (billing: "Overview", sentry: "Issues"). */
  indexLabel: string
  /**
   * Product wordmark shown next to the Hanzo brand mark in the shell header.
   * `''` = the brand mark ALONE (billing today). A product face like Sentry reads
   * "Sentry" in the Hanzo type — never an upstream wordmark, never a new brand.
   */
  wordmark: string
  /**
   * The route the shell boots into — `/` redirects here so a host that only ever
   * shows this face lands straight on it. `''` = the catalog home (full console).
   */
  home: string
}

/**
 * Every product shell, keyed by id — the ONE place a face's scope is declared
 * (`Record<ShellId, …>` forces every face to be present, so a new `ShellId` can't
 * silently miss its descriptor). `billing` keeps the mark-alone header (its legacy
 * look); the newer faces wear their product wordmark next to the Hanzo brand mark.
 * The single-screen faces (marketing/ads/social — one route, no sub-pages) surface a
 * lone "Overview" nav item; billing/sentry surface their root module's sub-pages.
 */
export const PRODUCT_SHELLS: Record<ShellId, ProductShell> = {
  console: { id: 'console', rootId: null, indexLabel: 'Overview', wordmark: '', home: '' },
  billing: { id: 'billing', rootId: 'billing', indexLabel: 'Overview', wordmark: '', home: 'billing' },
  marketing: { id: 'marketing', rootId: 'marketing', indexLabel: 'Overview', wordmark: 'Marketing', home: 'marketing' },
  ads: { id: 'ads', rootId: 'ads', indexLabel: 'Overview', wordmark: 'Ads', home: 'ads' },
  social: { id: 'social', rootId: 'social', indexLabel: 'Overview', wordmark: 'Publish', home: 'social' },
  sentry: { id: 'sentry', rootId: 'sentry', indexLabel: 'Issues', wordmark: 'Sentry', home: 'sentry' },
  dns: { id: 'dns', rootId: 'dns', indexLabel: 'Zones', wordmark: 'DNS', home: 'dns' },
}

/** The descriptor for a shell id. */
export const shellFor = (id: ShellId): ProductShell => PRODUCT_SHELLS[id]

/**
 * True when a shell scopes the console to a SINGLE product face (billing/sentry) —
 * i.e. it has a root module and a home to boot into. The full `console` is false.
 * ONE predicate the nav + home + catalog gates share.
 */
export const isProductShell = (id: ShellId): boolean => shellFor(id).rootId !== null
