/**
 * AI Accounts — the connectable-provider catalog (pure, shared by the client
 * Accounts/Overview tabs and the server routes).
 *
 * The AI providers mirror the headless `@hanzo/usage` provider registry ids
 * (`hanzo`/`codex`/`claude`) so a stored credential maps 1:1 to a usage-engine
 * descriptor. The non-AI groups are honest, catalog-driven "coming soon" rows (no
 * backend yet) — never fabricated integrations.
 */
import { BRANDS, brandForModel } from '~/components/ui/brand'

/** How an account is linked: a pasted API key, an OAuth token, or a web cookie header. */
export type ConnectMode = 'api' | 'oauth' | 'web'

export type AiProvider = {
  /** Matches the `@hanzo/usage` `providerRegistry` id. */
  id: 'hanzo' | 'codex' | 'claude'
  label: string
  /** Short vendor line. */
  vendor: string
  /** Supported link modes, in preference order (first = default). */
  modes: ConnectMode[]
  /** The native org lane — usage is always available from the org's own ledger, no key to paste. */
  native?: boolean
}

export const AI_PROVIDERS: AiProvider[] = [
  { id: 'hanzo', label: 'Hanzo', vendor: 'Hanzo Cloud', modes: ['api'], native: true },
  { id: 'codex', label: 'OpenAI / Codex', vendor: 'OpenAI', modes: ['api', 'oauth', 'web'] },
  { id: 'claude', label: 'Anthropic / Claude', vendor: 'Anthropic', modes: ['oauth', 'web', 'api'] },
]

export const aiProvider = (id: string): AiProvider | undefined => AI_PROVIDERS.find((p) => p.id === id)

/**
 * The vendor's own mark colour, RESOLVED from the ONE brand map (`ui/brand`) rather
 * than re-declared here — a model vendor's hue is THEIR identity and must not drift
 * from the logo shown beside it. Keyed off `vendor` first (the lane id is a product
 * name, so `codex` only resolves through "OpenAI"), via the same `brandForModel`
 * resolver the avatars use. The house lane has no vendor hue: it takes the chrome
 * token, because Hanzo IS the chrome here.
 */
export function providerColor(id: string): string {
  const key = brandForModel(aiProvider(id)?.vendor ?? '', id)
  if (!key || key === 'zen' || key === 'hanzo' || key === 'enso') return 'var(--color11)'
  return BRANDS[key].bg
}

export const isAiProvider = (id: string): id is AiProvider['id'] => AI_PROVIDERS.some((p) => p.id === id)

/** Label + which secret a mode's paste field carries. */
export const MODE_LABEL: Record<ConnectMode, string> = {
  api: 'API key',
  oauth: 'OAuth token',
  web: 'Cookie header',
}

/**
 * The org-level smart-routing defaults an admin set for the whole org, read from
 * cloud-api `GET /v1/router/defaults`. `autoRoutingActive` = routing is
 * enabled for the org at all; `defaultSessionRouting` = the default on/off a new
 * session inherits when the user has no explicit override.
 */
export type OrgRoutingDefaults = { autoRoutingActive: boolean; defaultSessionRouting: boolean }

/**
 * The EFFECTIVE smart-routing state for the Routing tab. PURE.
 *
 * `pref` is the user's own tri-state OVERRIDE from the sealed cookie: `true` = forced
 * on, `false` = forced off, `null` = never touched (follow the org default). `org` is
 * the server-driven default, or `null` when the defaults endpoint was unreachable
 * (older cloud-api, network error) — in which case we FAIL SOFT to the pre-endpoint
 * behavior: honor the user's own preference alone (off when never set).
 *
 * Precedence: an org that has turned routing OFF entirely (`autoRoutingActive:false`)
 * wins — the toggle is disabled with honest copy and nothing routes. Otherwise the
 * user's explicit override wins; absent one, the session follows the org default;
 * absent both (no org info), off — exactly today's default.
 */
export function resolveRouting(
  pref: boolean | null,
  org: OrgRoutingDefaults | null,
): { enabled: boolean; toggleDisabled: boolean; orgDefault: boolean | null } {
  if (org && !org.autoRoutingActive) return { enabled: false, toggleDisabled: true, orgDefault: null }
  const orgDefault = org ? org.defaultSessionRouting : null
  return { enabled: pref ?? orgDefault ?? false, toggleDisabled: false, orgDefault }
}

/** Placeholder integration groups — honest "coming soon", catalog-driven rows. */
export type ComingSoonGroup = { group: string; items: string[] }
export const COMING_SOON: ComingSoonGroup[] = [
  { group: 'GPUs & cloud', items: ['RunPod', 'Lambda', 'AWS', 'GCP', 'Azure'] },
  { group: 'Payments', items: ['Stripe', 'Square', 'PayPal'] },
  { group: 'Ecommerce', items: ['Shopify', 'WooCommerce'] },
  { group: 'Marketing', items: ['Mailchimp', 'HubSpot'] },
  { group: 'Analytics', items: ['Google Analytics', 'Mixpanel', 'PostHog'] },
]
