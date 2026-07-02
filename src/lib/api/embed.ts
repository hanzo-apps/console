/**
 * Embed API — the console's read of whether a brand's embedded app (Content Studio,
 * ERP, Help Center) is provisioned and reachable, over the same-origin
 * `/embed-status` route.
 *
 * The console does NOT reimplement Payload/Frappe: when an instance is live it
 * EMBEDS the real app (SSO iframe, over the brand IAM session); until then it shows
 * an honest state (provision CTA / not available). `/embed-status` is the ONE
 * server-side probe that decides which — it returns the exact server-vetted URL to
 * embed and a reachability boolean, and never fabricates an app.
 */
import { restGet } from './client'

export type EmbedAppId = 'cms' | 'erp' | 'help'
export type EmbedPhase = 'ready' | 'not-provisioned' | 'not-entitled' | (string & {})

export type EmbedStatus = {
  app: EmbedAppId
  /** The brand origin, e.g. `https://cms.hanzo.ai`. */
  origin: string
  /** The full URL to embed (origin + the app's landing path); '' when not entitled. */
  embedUrl: string
  /** True iff a live app answers on this brand's host. */
  reachable: boolean
  /**
   * True iff the caller OWNS this brand's shared instance (server-authoritative:
   * a brand-org member or global admin). A non-owning (customer) org is `false` and
   * receives no embed URL — the module shows the provision panel, never a
   * cross-tenant frame.
   */
  entitled: boolean
  phase: EmbedPhase
}

/** Defensive normalizer — a shape drift degrades to "not entitled / not reachable", never throws. */
export function normalizeEmbedStatus(app: EmbedAppId, raw: unknown): EmbedStatus {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const reachable = r.reachable === true
  // Strict: only an explicit true entitles. A missing field (or a stale server)
  // degrades to NOT entitled → the module shows the provision panel (fail-closed, no
  // cross-tenant frame).
  const entitled = r.entitled === true
  const origin = typeof r.origin === 'string' ? r.origin : ''
  // Keep an explicit '' (not entitled) as '' — only a MISSING url falls back to origin.
  const embedUrl = typeof r.embedUrl === 'string' ? r.embedUrl : origin
  const phase = typeof r.phase === 'string' && r.phase ? (r.phase as EmbedPhase) : reachable ? 'ready' : 'not-provisioned'
  return { app, origin, embedUrl, reachable, entitled, phase }
}

export const EmbedApi = {
  status: (app: EmbedAppId): Promise<EmbedStatus> =>
    restGet<unknown>(`/embed-status?app=${encodeURIComponent(app)}`).then((r) => normalizeEmbedStatus(app, r)),
}
