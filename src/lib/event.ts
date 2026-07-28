/**
 * The ONE telemetry client for the console — @hanzo/event, natively enabled.
 *
 * Analytics and product events (pageview · product event · identify) ride ONE
 * batched stream to the ONE Hanzo Cloud front door, POST /v1/event, which lenses
 * them server-side into web analytics and product insights. There is a SINGLE
 * instance, referenced as a value everywhere it's needed — the
 * `AnalyticsProvider` (pageviews + product `capture`) and the app's error
 * boundaries (`reportError`), so even the provider-less `global-error` boundary
 * reports through the same client. One client, no second path.
 *
 * ERRORS ARE A SECOND PLANE, and they do NOT ride the event stream. There is no
 * server-side fan-out from /v1/event into error tracking — a claim this file used
 * to make, which is precisely why the console reported ZERO errors. `captureError`
 * sends a Sentry envelope directly, authenticated by its own `dsn`. NO DSN => THE
 * ERROR PLANE IS INERT (fail-safe, by design). Requires @hanzo/event >= 0.3.2;
 * versions <= 0.3.1 had no envelope code at all.
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
 *  - `dsn` (`NEXT_PUBLIC_HANZO_EVENT_DSN`) — the error plane's own credential,
 *    shaped `https://<key>@api.hanzo.ai/v1/sentry/<project>`. Publishable by design
 *    (it ships in the client bundle). Unset → errors are captured and dropped.
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
import { setTelemetry } from '@hanzo/ui/telemetry'

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

/** Error-plane credential. Unset → captureError is inert (fail-safe). */
const dsn = process.env.NEXT_PUBLIC_HANZO_EVENT_DSN?.trim() || undefined

/**
 * The ONE console analytics client. Built once at module scope (SSR-safe: the
 * client's browser-only side effects are guarded and deferred to `init()`, which
 * the provider fires in an effect). Shared by the provider and the error boundaries.
 */
export const eventClient: Analytics = createAnalytics({
  product: 'console',
  host: '',
  ingestKey,
  dsn,
  enabled: consented(),
})

// ── The shared components emit through THIS client, not a second one ─────────
//
// @hanzo/ui instruments itself: DataTable, PrimaryButton, SlideOver, ConfirmDelete,
// the Field* editors, ComboBox, Segmented/SearchInput, MenuItemView, OrgSwitcher,
// ThemeToggle, Toast and EmptyState all report what a user did. They emit through
// module-scope `track()`, which resolves an AMBIENT client — and left alone that
// client would be a SECOND one: default host api.hanzo.ai, no cookie, no session.
// Cloud's anonymous lane admits only pageview + error, so every one of those
// component events would have been DROPPED on arrival.
//
// Registering `eventClient` as the ambient client is the whole fix, and it is what
// keeps the promise this file's header makes: ONE client, one batch, one anon id,
// one stream, same-origin with the session cookie — so component events arrive
// CREDENTIALED and are attributed to the signed-in org. `AnalyticsProvider` in
// Provider.tsx already hands this same instance to `useAnalytics()`.
//
// The wrapper is the `Telemetry` shape @hanzogui/telemetry hands out; every method
// delegates, so there is nothing here to keep in sync but the delegation itself.
setTelemetry({
  enabled: true,
  product: 'console',
  client: eventClient,
  track: (event, properties, commerce) => eventClient.capture(event, properties, commerce),
  pageview: (path, properties) => eventClient.pageview(path, properties),
  identify: (personId, traits) => eventClient.identify(personId, traits),
  group: (groupId, traits) => eventClient.group(groupId, traits),
  captureError: (err, context) => eventClient.captureError(err, context),
  captureException: (err, context) => eventClient.captureError(err, context),
  setCohort: (patch) => eventClient.setCohort(patch),
  flush: () => eventClient.flush(),
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
