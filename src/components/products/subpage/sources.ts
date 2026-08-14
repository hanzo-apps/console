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
 *  - metrics → the REAL per-org commerce usage ledger, scoped to THIS product by
 *              its `metadata.product` tag (honest-empty until spend is attributed).
 *              The raw model-serving/transport surface (inference/models/api/
 *              gateway) is the org-wide inference ledger itself — every ledger row
 *              IS one of its calls — so it reads the whole ledger and is framed as
 *              such (never masquerading as a narrow slice). Both real, per-org.
 *  - settings→ the product's REAL, product-specific configuration — endpoint/auth/
 *              connection facts the backend exposes + links to where that config is
 *              administered (API keys, the product's own admin surface) — plus, for
 *              an operator-managed service, its live deployment facts. Config a
 *              customer can't self-serve is stated honestly, never faked into a form.
 */
import type { CatalogEntry } from '~/lib/products/registry'
import type { HealthSource } from '~/components/products/overview/spec'
import { OVERVIEW_SPECS } from '~/components/products/overview/spec'
import { resolveSpec } from '~/components/products/overview/resolve'

/**
 * How a product's Metrics sub-page scopes the ONE real source — the commerce usage
 * ledger. `product` is the `metadata.product` tag to filter by (`null` = the whole
 * org inference ledger); `scope` is how to FRAME it honestly.
 */
export type MetricsScope = {
  /** The `metadata.product` tag to keep; `null` = the whole ledger (unfiltered). */
  product: string | null
  /**
   * - `inference-all`: the raw model-serving/transport surface (inference/models/
   *   api/gateway). Every ledger row IS one of this product's calls, so it reads the
   *   whole inference ledger — and the view frames it as org-wide inference, never as
   *   a fabricated per-product slice.
   * - `product`: every other product. The ledger is filtered to this product's own
   *   `metadata.product` tag (honest-empty until cloud attributes spend to it) — it
   *   NEVER shows the whole-org aggregate under one product's name.
   */
  scope: 'inference-all' | 'product'
}

/** How a product's Settings sub-page resolves. */
export type SettingsFeed =
  /** A real, product-specific settings route (e.g. a config tab the product owns). */
  | { kind: 'route'; to: string }
  /** No bespoke settings — show the honest managed state (config facts + org link). */
  | { kind: 'managed' }

/** One real, read-only configuration fact for a product (endpoint/auth/connection). */
export type SettingsFact = { label: string; value: string | null; hint?: string }

/** A real in-console link to where a product's config actually lives. */
export type SettingsLink = { label: string; to: string }

/**
 * The product-specific, REAL configuration surfaced on a product's Settings sub-page:
 * the connection/endpoint/auth facts the backend exposes, plus links to where the
 * config is administered. Honest by construction — only facts that are real; anything
 * unknown reads an em dash, and a product with no self-serve config still links to its
 * own admin surface + org Settings (never a dead generic form).
 */
export type SettingsConfig = { facts: SettingsFact[]; links: SettingsLink[] }

/** The resolved real sources for one product's uniform sub-pages. */
export type SubpageSources = {
  /** Real health source (reused verbatim from the native-overview spec). */
  status: HealthSource
  /**
   * Candidate operator-service name to filter the apps inventory (deployment state)
   * by. From an explicit override, else the overview health spec, else the repo
   * basename / product id. `null` for a product with no plausible discrete service
   * (the views then show an honest managed state, never a false negative).
   */
  service: string | null
  /**
   * The product's OpenTelemetry `service.name` — the label it emits spans/logs/metrics
   * under, used to scope the LIVE o11y (O11y) reads (Status health, Logs, Metrics
   * latency) to THIS product. Derived from the OTel convention (service.name = the
   * binary/repo name), with a tiny override for the few that differ. `null` for a
   * product with no backing service. Orthogonal to `service` (the k8s operator-app
   * name for deployment state) — a product may emit telemetry under one name and be
   * deployed under another, so both are candidates when reading health.
   */
  o11yService: string | null
  /** How the Metrics sub-page scopes the usage ledger (per-product / org-wide inference). */
  metrics: MetricsScope
  /** How the Settings sub-page resolves. */
  settings: SettingsFeed
}

/**
 * The raw model-serving / transport surface. The commerce usage ledger is ENTIRELY
 * inference calls (every row is type "inference"), and every one of them flows through
 * these surfaces — so their Metrics IS the whole ledger (framed as org-wide inference).
 * Every OTHER product filters by its own `metadata.product` tag (honest-empty until
 * attributed), so the org total is never shown under one product's name.
 */
export const INFERENCE_SURFACE_PRODUCTS = new Set<string>(['inference', 'models', 'api', 'gateway'])

/** The per-product Metrics ledger scope — the ONE place the decision lives (DRY). */
export function metricsScopeFor(id: string): MetricsScope {
  return INFERENCE_SURFACE_PRODUCTS.has(id)
    ? { product: null, scope: 'inference-all' }
    : { product: id, scope: 'product' }
}

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

/**
 * Explicit product → operator-service overrides, for the handful of products whose
 * real service in the apps inventory differs from the derived name. Verified against
 * the live `GET /v1/apps` inventory — each maps to a service that genuinely appears,
 * so Status/Logs light up REAL health instead of a false "not deployed". A product
 * NOT here uses the spec service, then the repo basename, then its id.
 */
const SERVICE_OVERRIDE: Record<string, string> = {
  // repo `hanzoai/ai` derives `ai`; the operator app that serves the model catalog is `models`.
  models: 'models',
  // repo `hanzoai/bot` derives `bot`; the operator app is the agent gateway `bot-gateway`.
  bot: 'bot-gateway',
  // id `helpdesk`; the operator app for the live Help Center is `help`.
  helpdesk: 'help',
}

/** repo basename, e.g. `hanzoai/vector` → `vector`; null when absent. */
const repoBase = (repo?: string): string | null => (repo ? repo.split('/').pop() || null : null)

/**
 * Products whose OpenTelemetry `service.name` differs from their repo basename (the
 * default). Kept tiny — the OTel convention is service.name = the binary/repo name, so
 * the repo basename is right for the vast majority (iam→iam, vector→vector, the AI
 * products→ai, the Observe products→o11y, …). A product NOT here uses the repo
 * basename, then its id. A wrong guess yields an honest empty o11y state, never
 * another service's telemetry (the reads exact-match the service name).
 */
const O11Y_SERVICE_OVERRIDE: Record<string, string> = {
  // The agent gateway emits under its gateway service name, not the `bot` repo base.
  bot: 'bot-gateway',
}

/**
 * The product's OTel `service.name` — the label its telemetry (spans/logs/metrics)
 * carries, used to scope the LIVE o11y reads to THIS product. ONE decision, one place
 * (DRY). `null` for a product with no backing service (org/account admin, cross-cutting
 * rollups) — its o11y sub-pages then show an honest managed state, never a false read.
 */
export function o11yServiceFor(entry: CatalogEntry): string | null {
  if (NO_SERVICE.has(entry.id)) return null
  return O11Y_SERVICE_OVERRIDE[entry.id] ?? repoBase(entry.repo) ?? entry.id
}

/**
 * AI products that call the unified gateway — their real, product-specific config is
 * the gateway endpoint + credential (an IAM bearer or an `sk-` key). Used for the
 * Settings config of the ones that don't carry a bespoke overview spec.
 */
const GATEWAY_AI_PRODUCTS = new Set<string>([
  'models',
  'providers',
  'inference',
  'embeddings',
  'playground',
  'prompts',
  'agents',
  'chat',
])

/** Managed data resources whose real config is a per-instance connection string. */
const DATA_RESOURCE_PRODUCTS = new Set<string>([
  'vector',
  'sql',
  'kv',
  's3',
  'datastore',
  'docdb',
  'search',
  'base',
  'records',
  'memory',
])

/**
 * Product-specific, REAL configuration for the Settings sub-page. DRY: a product with
 * a registered native-overview spec reuses its declared facts (Base URL / Auth / …)
 * and actions verbatim — one per-product content source, no duplication. Everything
 * else derives an honest, category-appropriate config (gateway endpoint + API keys for
 * an AI product; a connection pointer + the product's own page for a data resource; a
 * managed pointer otherwise). Only real facts; anything unknown renders "—".
 */
export function settingsConfigFor(entry: CatalogEntry): SettingsConfig {
  const spec = OVERVIEW_SPECS[entry.id]
  if (spec) {
    return {
      facts: spec.facts.map((f) => ({ label: f.label, value: f.value ?? null, hint: f.hint })),
      links: spec.actions.map((a) => ({ label: a.label, to: a.to })),
    }
  }

  const openSelf: SettingsLink = { label: `Open ${entry.label}`, to: `/${entry.id}` }
  const apiKeys: SettingsLink = { label: 'Manage API keys', to: '/api-keys' }

  if (GATEWAY_AI_PRODUCTS.has(entry.id)) {
    return {
      facts: [
        { label: 'Endpoint', value: 'api.hanzo.ai/v1' },
        { label: 'Auth', value: 'Bearer — IAM token or sk- key' },
        { label: 'Request shape', value: 'Standard /v1 chat completions' },
      ],
      links: [apiKeys, openSelf],
    }
  }

  if (DATA_RESOURCE_PRODUCTS.has(entry.id)) {
    return {
      facts: [
        { label: 'Access', value: 'Connection string', hint: `Open ${entry.label} → Connect` },
        { label: 'Scope', value: 'Your organization' },
      ],
      links: [openSelf, apiKeys],
    }
  }

  if (entry.category === 'Security') {
    return {
      facts: [
        { label: 'Managed by', value: 'Hanzo' },
        { label: 'Scope', value: 'Your organization' },
      ],
      links: [openSelf],
    }
  }

  // Honest default: no self-serve config surfaced here — point at the product's own
  // page (where its real config lives) rather than a dead form.
  return { facts: [{ label: 'Scope', value: 'Your organization' }], links: [openSelf] }
}

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
    : (SERVICE_OVERRIDE[entry.id] ??
      (status.kind === 'platform-app' ? status.service : repoBase(entry.repo) ?? entry.id))
  const o11yService = o11yServiceFor(entry)
  const metrics = metricsScopeFor(entry.id)
  const route = SETTINGS_ROUTE[entry.id]
  const settings: SettingsFeed = route ? { kind: 'route', to: route } : { kind: 'managed' }
  return { status, service, o11yService, metrics, settings }
}
