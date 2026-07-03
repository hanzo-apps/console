/**
 * ProductLanding — the shared config contract every product supplies to get a
 * polished landing/overview: a hero, live count-up metrics, an interactive code
 * sample block, and a resources rail. One landing system, DRY across products
 * (the same registry-style pattern as the living-overview configs).
 *
 * Types only — erased at build; no runtime, unit-testable pure logic lives in
 * `logic.ts`.
 */
import type { ReactElement, ReactNode } from 'react'

import type { ProductIcon } from '~/lib/products/registry'

/** Languages the interactive code block offers. */
export type CodeLang = 'curl' | 'python' | 'ts' | 'js'

/** One copyable code sample — the REAL API call for the product. */
export interface CodeSample {
  lang: CodeLang
  /** Tab label, e.g. "cURL", "Python", "TypeScript", "JavaScript". */
  label: string
  code: string
}

/** A call-to-action — an in-app handler OR an external link. `icon` is an element
 *  (a rendered `<Plus />`) so it satisfies the Button `icon` prop. */
export interface LandingAction {
  label: string
  onPress?: () => void
  href?: string
  icon?: ReactElement
}

/** One headline metric — a real value (null → honest "—"), optional trend + delta. */
export interface LandingMetric {
  key: string
  label: string
  /** Current value, or null when the backend doesn't report it (renders "—"). */
  value: number | null
  /** Formats the (count-up) value; defaults to a localized integer. */
  format?: (n: number) => string
  /** Real time series for the sparkline (≥2 points, else omitted — never faked). */
  series?: number[]
  /** Fractional/percent change vs the prior window; null → honest em-dash. */
  deltaPct?: number | null
  icon?: ReactNode
  /** A small honest caption shown when there is no series (e.g. "Awaiting metering"). */
  hint?: string
}

/** A resource rail row (Documentation / Quick Start / Examples / Support …). */
export interface ResourceLink {
  id: string
  label: string
  sub?: string
  href?: string
  onPress?: () => void
  icon?: ReactNode
}

/**
 * The full landing config a product composes. `metrics` (controlled by the parent)
 * OR `loadMetrics` (self-loading + polling) drives the live KPI row; supply one.
 */
export interface ProductLandingConfig {
  productId: string
  title: string
  /** One-line "what it is". */
  tagline: string
  icon?: ProductIcon
  /** Docs path segment under the brand docs host (e.g. 'embeddings'). */
  docsProduct: string
  /** The hero's primary + optional secondary CTA. */
  primary?: LandingAction
  secondary?: LandingAction
  /** Controlled metrics (parent owns the data). */
  metrics?: LandingMetric[]
  /** Self-loading metrics (real data / honest gaps) — used with `pollMs`. */
  loadMetrics?: () => Promise<LandingMetric[]>
  /** Poll interval for `loadMetrics` in ms (0/undefined → load once, no poll). */
  pollMs?: number
  /** Interactive, copyable code samples (curl/python/ts/js). */
  samples?: CodeSample[]
  /** A "Run"/"Try in Playground" affordance for the code block. */
  run?: LandingAction
  /** Quick-action rows appended to the resource rail. */
  actions?: LandingAction[]
  /** Extra resource rows appended after the standard ones. */
  resources?: ResourceLink[]
}
