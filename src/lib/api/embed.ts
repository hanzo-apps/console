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
export type EmbedPhase = 'ready' | 'not-provisioned' | (string & {})

export type EmbedStatus = {
  app: EmbedAppId
  /** The brand origin, e.g. `https://cms.hanzo.ai`. */
  origin: string
  /** The full URL to embed (origin + the app's landing path). */
  embedUrl: string
  /** True iff a live app answers on this brand's host. */
  reachable: boolean
  phase: EmbedPhase
}

/** Defensive normalizer — a shape drift degrades to "not reachable", never throws. */
export function normalizeEmbedStatus(app: EmbedAppId, raw: unknown): EmbedStatus {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const reachable = r.reachable === true
  const origin = typeof r.origin === 'string' ? r.origin : ''
  const embedUrl = typeof r.embedUrl === 'string' && r.embedUrl ? r.embedUrl : origin
  const phase = typeof r.phase === 'string' && r.phase ? (r.phase as EmbedPhase) : reachable ? 'ready' : 'not-provisioned'
  return { app, origin, embedUrl, reachable, phase }
}

export const EmbedApi = {
  status: (app: EmbedAppId): Promise<EmbedStatus> =>
    restGet<unknown>(`/embed-status?app=${encodeURIComponent(app)}`).then((r) => normalizeEmbedStatus(app, r)),
}
