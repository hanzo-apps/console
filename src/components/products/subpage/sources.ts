/**
 * Per-product sub-page SOURCES — the ONE metadata map that drives the shared
 * per-product Status / Logs / Metrics / Settings system. Pure (no GUI), so it is
 * unit-testable and the sub-page views stay presentational.
 *
 * Every product gets a REAL feed OR an honest state, derived from the catalog +
 * the native-overview health spec — NOT 105 bespoke pages. The console has ONE
 * way to answer "what backs this product's status/logs/metrics/settings":
 *
 *  - status  → the product's operator service in the platform apps inventory (the
 *              SAME source the native overview's health band reads). A customer who
 *              can't read the control plane gets an honest "managed by Hanzo"; an
 *              admin gets the real per-service health. Never a fabricated green.
 *  - logs    → the platform log stream filtered to that operator service, when the
 *              product has one; otherwise an honest "no product log source".
 *  - metrics → for AI/LLM products, the org's REAL o11y trace analytics; for every
 *              other product, the commerce usage ledger filtered to the product tag
 *              (honest-empty until spend is attributed). Both are real, per-org.
 *  - settings→ a real per-product settings route where one exists; otherwise the
 *              product's real deployment facts (image/tag/cluster, read-only) plus a
 *              link to org Settings — an honest managed state, never a dead form.
 */
import type { CatalogEntry } from '~/lib/products/registry'
import type { HealthSource } from '~/components/products/overview/spec'
import { resolveSpec } from '~/components/products/overview/resolve'

/** Which real feed backs a product's Metrics sub-page. */
export type MetricsFeed =
  /** AI/LLM product → the org's real o11y trace analytics (traces/tokens/latency/spend). */
  | 'o11y'
  /** Anything else → the commerce usage ledger filtered to this product's tag. */
  | 'usage'

/** How a product's Settings sub-page resolves. */
export type SettingsFeed =
  /** A real, product-specific settings route (e.g. a config tab the product owns). */
  | { kind: 'route'; to: string }
  /** No bespoke settings — show the honest managed state (deployment facts + org link). */
  | { kind: 'managed' }

/** The resolved real sources for one product's uniform sub-pages. */
export type SubpageSources = {
  /** Real health source (reused verbatim from the native-overview spec). */
  status: HealthSource
  /**
   * Candidate operator-service name to filter the apps inventory + platform logs
   * by. From the overview health spec when declared, else derived from the repo
   * basename / product id. `null` for a product with no plausible discrete
   * service (the views then show an honest managed state, never a false negative).
   */
  service: string | null
  /** Which real metrics feed backs the Metrics sub-page. */
  metrics: MetricsFeed
  /** How the Settings sub-page resolves. */
  settings: SettingsFeed
}

/**
 * AI/LLM products whose Metrics sub-page shows the org's REAL o11y trace analytics
 * (the same traces/tokens/latency/spend the Metrics product renders). Every other
 * product's Metrics reads the usage ledger filtered to its own product tag.
 */
export const O11Y_METRICS_PRODUCTS = new Set<string>([
  'models',
  'providers',
  'inference',
  'chat',
  'agents',
  'playground',
  'embeddings',
  'prompts',
  'gateway',
  'api',
])

/**
 * Products with a real, product-specific settings ROUTE (rendered by the product
 * itself). Kept tiny on purpose — most products have no bespoke settings surface
 * and correctly resolve to the honest managed state. A base slug the product owns
 * as a DECLARED specific (Embeddings › Settings) never reaches this map — the
 * router hands it to the product's own route — so this is only for products that
 * expose settings at a NON-base path.
 */
const SETTINGS_ROUTE: Record<string, string> = {}

/** Products with no plausible discrete operator service — status/logs stay honest-managed. */
const NO_SERVICE = new Set<string>([
  // Pure org/account administration (no deployed service of their own).
  'settings',
  'team',
  'profile',
  'api-keys',
  // Cross-cutting billing/observe rollups (their data comes from other services).
  'billing',
  'plans',
  'cost',
  'referrals',
  'wallet',
])

/** repo basename, e.g. `hanzoai/vector` → `vector`; null when absent. */
const repoBase = (repo?: string): string | null => (repo ? repo.split('/').pop() || null : null)

/**
 * Resolve the real sub-page sources for a catalog entry. Deterministic + pure, so
 * the metadata that ships is the metadata under test. Adding a product needs NO
 * change here — it inherits the honest defaults; a product only appears in the
 * small override sets when it genuinely differs.
 */
export function subpageSourcesFor(entry: CatalogEntry): SubpageSources {
  const status = resolveSpec(entry).health
  const service = NO_SERVICE.has(entry.id)
    ? null
    : status.kind === 'platform-app'
      ? status.service
      : repoBase(entry.repo) ?? entry.id
  const metrics: MetricsFeed = O11Y_METRICS_PRODUCTS.has(entry.id) ? 'o11y' : 'usage'
  const route = SETTINGS_ROUTE[entry.id]
  const settings: SettingsFeed = route ? { kind: 'route', to: route } : { kind: 'managed' }
  return { status, service, metrics, settings }
}
