/**
 * Router client — the per-org router policy over the canonical
 * same-origin `/v1` surface (v1-first: no service prefix, no nested version).
 *
 *   GET  /v1/get-router-policy     → the effective policy resolved for the
 *                                    caller's org (org > "*" > conf)
 *   POST /v1/update-router-policy  → upsert the caller's OWN org policy
 *
 * Standalone console: the next.config AI-head dispatch terminates these at the
 * `/ai` user-bearer proxy (session cookie → short-lived minted bearer → the
 * hanzoai/ai gateway; org from the token owner, never browser-supplied).
 * go:embed console: the same `/v1/*` paths hit cloud natively. Both endpoints
 * are org-admin gated server-side, so a customer configures only their own org.
 *
 * The policy is the org's router prefer table (task tag → ordered model ids,
 * "default" is the catch-all) + a per-1k cost ceiling. An empty prefer + 0
 * ceiling clears the org override (reverts to "*" then conf).
 */
import { originGet, originPost } from './client'

/** The effective router policy for the caller's org, plus whether the org has its own override. */
export type RouterPolicy = {
  prefer: Record<string, string[]>
  costCeiling: number
  hasOverride?: boolean
}

export const RouterPolicyApi = {
  /** The effective policy resolved for the caller's own org (org > "*" > conf). */
  get: (): Promise<RouterPolicy> => originGet('get-router-policy'),
  /** Upsert the caller's OWN org policy. Empty prefer + 0 ceiling clears the override. */
  save: (body: RouterPolicy): Promise<RouterPolicy> => originPost('update-router-policy', body),
}
