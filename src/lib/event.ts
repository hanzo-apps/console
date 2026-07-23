/**
 * The ONE telemetry client for the console — @hanzo/event, natively enabled.
 *
 * Every kind of signal (pageview · product event · identify · error) rides ONE
 * batched stream to the ONE Hanzo Cloud front door, POST /v1/event, which lenses
 * it server-side into web analytics, product insights, and error tracking. There
 * is a SINGLE instance, referenced as a value everywhere it's needed — the
 * `AnalyticsProvider` (pageviews + product `capture`) and the app's error
 * boundaries (`reportError`), so even the provider-less `global-error` boundary
 * reports to the same stream. One client, one wire, no second path.
 *
 * Wiring for the console SPA:
 *  - `host: ''` — SAME-ORIGIN. Events POST to the console's own `/v1/event`, so the
 *    first-party session cookie rides along (the go:embed cloud binary serves it
 *    natively; the standalone BFF forwards it as the signed-in user). The client
 *    NEVER sends an org/tenant — Cloud stamps it from the validated session.
 *  - `ingestKey` (optional, `NEXT_PUBLIC_EVENT_INGEST_KEY`) — a publishable pk_ key
 *    for LOGGED-OUT / public views (sign-in, marketing faces) so their pageviews +
 *    errors ingest without a session. Unset → logged-in flows via the cookie and
 *    logged-out is best-effort anonymous. Mint one per org via POST /v1/ingest/keys.
 *  - auto error capture is ON by default (window.onerror + unhandledrejection),
 *    making this the app-wide error path (subsumes @sentry). React render errors —
 *    which React swallows before window.onerror — are reported from the boundaries
 *    via `reportError`.
 *
 * Consent + PII: the stream is PII-free by construction — a random anon id + the
 * stable `owner/name` actor id (never an email), org never sent. On top of that we
 * honor an explicit browser opt-out (Global Privacy Control / Do-Not-Track): a
 * visitor who signals it is not tracked at all. This is the consent layer for the
 * logged-out marketing/public views.
 */
import { createAnalytics, type Analytics } from '@hanzo/event'

/** Honor an explicit browser opt-out signal (GPC, then legacy DNT). SSR (no
 *  navigator) defaults to enabled; the browser instance reads the real signal. */
function consented(): boolean {
  if (typeof navigator === 'undefined') return true
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean; doNotTrack?: string | null }
  if (nav.globalPrivacyControl === true) return false
  const dnt = nav.doNotTrack
  return dnt !== '1' && dnt !== 'yes'
}

/** Publishable ingest key for logged-out ingestion; empty → same-origin cookie/anon. */
const ingestKey = process.env.NEXT_PUBLIC_EVENT_INGEST_KEY?.trim() || undefined

/**
 * The ONE console analytics client. Built once at module scope (SSR-safe: the
 * client's browser-only side effects are guarded and deferred to `init()`, which
 * the provider fires in an effect). Shared by the provider and the error boundaries.
 */
export const eventClient: Analytics = createAnalytics({
  product: 'console',
  host: '',
  ingestKey,
  enabled: consented(),
})

/**
 * Report a caught / React-boundary error to the ONE error stream. Marks it handled
 * (the app caught it) and never throws back — telemetry must not break recovery.
 */
export function reportError(err: unknown, properties?: Record<string, unknown>): void {
  try {
    eventClient.captureError(err, { handled: true, properties })
  } catch {
    /* fail-soft — a telemetry failure must never mask the real error */
  }
}
