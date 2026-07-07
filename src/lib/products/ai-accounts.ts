/**
 * AI Accounts — the connectable-provider catalog (pure, shared by the client
 * Accounts/Overview tabs and the server routes).
 *
 * The AI providers mirror the headless `@hanzo/usage` provider registry ids
 * (`hanzo`/`codex`/`claude`) so a stored credential maps 1:1 to a usage-engine
 * descriptor. The non-AI groups are honest, catalog-driven "coming soon" rows (no
 * backend yet) — never fabricated integrations.
 */

/** How an account is linked: a pasted API key, an OAuth token, or a web cookie header. */
export type ConnectMode = 'api' | 'oauth' | 'web'

export type AiProvider = {
  /** Matches the `@hanzo/usage` `providerRegistry` id. */
  id: 'hanzo' | 'codex' | 'claude'
  label: string
  /** Short vendor line. */
  vendor: string
  /** Brand accent (CSS color). */
  color: string
  /** Supported link modes, in preference order (first = default). */
  modes: ConnectMode[]
  /** The native org lane — usage is always available from the org's own ledger, no key to paste. */
  native?: boolean
}

export const AI_PROVIDERS: AiProvider[] = [
  { id: 'hanzo', label: 'Hanzo', vendor: 'Hanzo Cloud', color: '#111111', modes: ['api'], native: true },
  { id: 'codex', label: 'OpenAI / Codex', vendor: 'OpenAI', color: '#10a37f', modes: ['api', 'oauth', 'web'] },
  { id: 'claude', label: 'Anthropic / Claude', vendor: 'Anthropic', color: '#d97757', modes: ['oauth', 'web', 'api'] },
]

export const aiProvider = (id: string): AiProvider | undefined => AI_PROVIDERS.find((p) => p.id === id)

export const isAiProvider = (id: string): id is AiProvider['id'] => AI_PROVIDERS.some((p) => p.id === id)

/** Label + which secret a mode's paste field carries. */
export const MODE_LABEL: Record<ConnectMode, string> = {
  api: 'API key',
  oauth: 'OAuth token',
  web: 'Cookie header',
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
