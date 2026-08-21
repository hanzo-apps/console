/**
 * Provider admin API — the platform-wide AI-PROVIDER control board (admin.hanzo.ai).
 *
 * This is the ADMIN management surface, distinct from the customer-facing
 * `ProviderApi` (BYOK per-org provider CRUD) and from `ProvidersModule` (the model
 * catalog browser). It reads the SHARED-GATEWAY provider routing that applies to every
 * org: which upstream providers are enabled (do-ai, openrouter, fireworks,
 * openai-direct, zen) and which one is primary. DO-first is the backend's state, not a
 * UI assumption — the board renders whatever the cross-tenant list returns.
 *
 * SOURCE: `GET /v1/ai/providers/global` — the ai capability's cross-tenant provider
 * list, over the console's OWN origin and its `/v1` bearer proxy. It is READ-ONLY here.
 * Flipping a provider's routing state is not a console action: the primary is a single
 * platform-wide value and moving it means turning one provider on and another off
 * together, which no per-row write can promise. The browser holds no admin credential
 * and NEVER sees a provider key — `keyPresent` is a boolean, never the secret.
 *
 * Coded to the documented shape and OPTIONAL-SAFE: `normalizeProvider` maps whatever
 * the endpoint returns onto `AdminProvider`, and every missing field degrades to a
 * real default — a deployment where the admin backend isn't yet routed (`ApiError
 * 404`) renders an honest state, NEVER fabricated rows or a fabricated health.
 *
 * INTEGRATION FLAG (do NOT lose this): a provider's `enabled` state ALSO gates it out
 * of the pricing catalog — the DO-first `ENABLE_OPENROUTER` integration. The pricing
 * sync reads the provider-enabled state, so a disabled `openrouter` has no models in
 * `/v1/pricing/models` (and thus none in the customer model catalog / marketplace).
 * One provider-enabled state, two consumers — which is why the board reports it.
 */
import { originGet } from './client'

/**
 * One provider row on the admin control board. The KEY is NEVER on this shape —
 * `keyPresent` reports only whether the KMS secret resolves (a boolean), never the
 * secret material. Money is not modeled here (this is routing config, not billing).
 */
export interface AdminProvider {
  /** Stable provider name — `do-ai` | `openrouter` | `fireworks` | `openai-direct` | `zen`. */
  name: string
  /** Human display name for the row. */
  displayName: string
  /** Provider kind — `DigitalOcean` | `OpenAI` | `Fireworks` | `OpenRouter` | … */
  type: string
  /** Enabled routing (backend `State == "Active"`). */
  enabled: boolean
  /** The single primary/default provider (backend `IsDefault`). */
  primary: boolean
  /** Whether the KMS-backed provider secret resolves. NEVER the key itself. */
  keyPresent: boolean
  /** How many models route to this provider. */
  modelCount: number
  /** The provider's upstream base URL (display only). */
  providerUrl: string
}

/**
 * The honest, DERIVED health verdict for a provider row. NOT a live probe — it is a
 * pure function of the two facts the board already has (`enabled`, `keyPresent`), so
 * it never fabricates a green. The UI labels it as derived, not measured.
 *  - `off`   : the provider is disabled — nothing routes to it.
 *  - `no-key`: enabled but the KMS secret is missing — calls would fail.
 *  - `ready` : enabled AND its key resolves — routable.
 */
export type ProviderHealth = 'ready' | 'no-key' | 'off'

/**
 * Derive the honest health from the enabled/keyPresent facts. Pure + total (no
 * network) — the exact matrix:
 *   disabled                 → 'off'    (regardless of key)
 *   enabled  && keyPresent   → 'ready'
 *   enabled  && !keyPresent  → 'no-key'
 */
export function deriveHealth(p: Pick<AdminProvider, 'enabled' | 'keyPresent'>): ProviderHealth {
  if (!p.enabled) return 'off'
  return p.keyPresent ? 'ready' : 'no-key'
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const bool = (v: unknown): boolean => v === true
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

/**
 * Map an arbitrary provider payload onto `AdminProvider` (optional-safe). Tolerates
 * snake_case and camelCase for every field, so a small backend-shape drift degrades
 * gracefully rather than throwing. `displayName` falls back to `name`; `keyPresent`
 * is strict-true (a missing/garbage value reads as MISSING — fail-closed for the
 * "has a key?" signal, so we never claim a key that isn't proven present).
 */
export function normalizeProvider(raw: unknown): AdminProvider {
  const r = (raw ?? {}) as Record<string, unknown>
  const name = str(r.name)
  return {
    name,
    displayName: str(r.displayName) || str(r.display_name) || name,
    type: str(r.type),
    enabled: bool(r.enabled),
    primary: bool(r.primary) || bool(r.isDefault) || bool(r.is_default),
    keyPresent: bool(r.keyPresent) || bool(r.key_present),
    modelCount: num(r.modelCount ?? r.model_count),
    providerUrl: str(r.providerUrl) || str(r.provider_url),
  }
}

/** Normalize a list payload (tolerate a bare array or a `{ providers: [...] }` wrap). */
function normalizeList(data: unknown): AdminProvider[] {
  const list = Array.isArray(data)
    ? data
    : Array.isArray((data as { providers?: unknown[] })?.providers)
      ? (data as { providers: unknown[] }).providers
      : []
  return list.map(normalizeProvider)
}

// Endpoint mapping (client → server): `originGet('ai/providers/global')` builds the
// same-origin `<origin>/v1/ai/providers/global`, which falls through to the console's
// `/v1` bearer proxy → cloud-api. Never `/api/`, never a direct cloud-origin call.
export const ProviderAdminApi = {
  /**
   * The platform-wide provider list, across tenants. Throws a typed `ApiError` (403
   * when the caller isn't a global admin, 404 when the ai backend isn't routed) the
   * caller renders as an honest state.
   */
  list: async (): Promise<AdminProvider[]> => normalizeList(await originGet<unknown>('ai/providers/global')),
}
