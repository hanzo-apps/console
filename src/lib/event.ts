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
 *  - `host: ''` — SAME-ORIGIN. Events POST to the console's own `/v1/event`. The
 *    client NEVER sends an org/tenant — Cloud stamps it from the validated bearer.
 *  - `getToken` — the signed-in visitor's own Hanzo IAM access token. THIS is what
 *    attributes the stream, and it is the only mechanism that is correct here; see
 *    the note below for why no publishable key is passed.
 *  - `dsn` (`NEXT_PUBLIC_HANZO_EVENT_DSN`) — the error plane's own credential,
 *    shaped `https://<key>@api.hanzo.ai/v1/sentry/<project>`. Publishable by design
 *    (it ships in the client bundle). Unset → errors are captured and dropped.
 *  - auto error capture is ON by default (window.onerror + unhandledrejection),
 *    making this the app-wide error path (subsumes @sentry). React render errors —
 *    which React swallows before window.onerror — are reported from the boundaries
 *    via `reportError`.
 *
 * Consent + PII: the stream is PII-free by construction — a random anon id + the
 * IAM user id (never an email), org never sent. On top of that we honor an
 * explicit browser opt-out (Global Privacy Control / Do-Not-Track): a
 * visitor who signals it is not tracked at all. This is the consent layer for the
 * logged-out marketing/public views.
 */
import { createAnalytics, type Analytics } from '@hanzo/event'
import { setTelemetry } from '@hanzo/ui/telemetry'

import { iamAccessToken, iamExpiresInSeconds, iamValidAccessToken } from '~/lib/auth/iam'

/** Honor an explicit browser opt-out signal (GPC, then legacy DNT). SSR (no
 *  navigator) defaults to enabled; the browser instance reads the real signal. */
function consented(): boolean {
  if (typeof navigator === 'undefined') return true
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean; doNotTrack?: string | null }
  if (nav.globalPrivacyControl === true) return false
  const dnt = nav.doNotTrack
  return dnt !== '1' && dnt !== 'yes'
}

// ── No publishable ingest key is passed, and that is DELIBERATE ──────────────
//
// Do not "fix" this by adding a build arg or by reading NEXT_PUBLIC_EVENT_INGEST_KEY
// here.
//
// A `pk-` resolves to exactly ONE org (cloud stamps the tenant from the key), and
// this image is brand-agnostic: one build serves cloud.hanzo.ai, cloud.lux.cloud and
// cloud.zoo.cloud, with the brand resolved at RUNTIME from the request hostname
// (src/config). Baking a key would file every brand's — and every customer's —
// traffic into whichever org the key belongs to, which is both wrong data and a
// cross-tenant leak. It is the same reason Dockerfile bakes no NEXT_PUBLIC_*.
//
// Worse, it would be SILENT: @hanzo/event resolves the outgoing credential as
// `ingestKey ?? token`, so a key takes PRECEDENCE over the bearer — setting one
// would OVERRIDE each signed-in user's own identity rather than supplement it.
//
// THE COOKIE IS NOT A CREDENTIAL HERE. This file used to claim that posting
// same-origin let the first-party session ride along, so signed-in traffic landed
// correctly. It does not. That cookie is the casibase session, while cloud resolves
// a tenant from a VALIDATED IAM bearer (SanitizeIdentity) — so a cookie-only POST
// carries no principal. It is not refused: it silently takes the ANONYMOUS lane,
// which files every row under the `$public` tenant (a partition no org can read) and
// drops `identify` with a 200 receipt. Production proved it — 498 console rows, all
// `$public`, zero identified users.
//
// `getToken` below is the fix, and it has neither problem: cloud resolves the tenant
// from the token's OWN owner claim, so each visitor's events land in THEIR org, on
// every brand host, with no per-brand configuration. Logged-out views carry no token
// and stay anonymous — the honest outcome for a visitor who has not identified
// themselves, and still the open question for the public/marketing faces (closing
// that needs a PER-HOST key resolved at RUNTIME, e.g. the `GET /v1/brand?host=`
// shape src/config already anticipates; a module-scope const cannot receive it).

// ── The bearer is kept fresh, because `getToken` cannot await ────────────────
//
// @hanzo/event's contract is `getToken?: () => string | undefined | null` — it is
// called at FLUSH time and is strictly synchronous, so the refresh cannot happen
// inside it. Keep the SDK's STORED token valid instead and let `getToken` read it:
// `iamValidAccessToken()` refreshes in place, so one background call makes every
// later read — and every event batched after it — carry a live bearer.
//
// This matters because the door is fail-closed on the CREDENTIAL, not on the
// request. An unresolvable bearer is not an error: it silently takes the ANONYMOUS
// lane, which admits only pageview and error. So a lapsed token drops `identify`
// and every product event, and still answers 200 — the same invisible loss the
// session cookie caused, just through a narrower window.
//
// Single-flight: IAM rotates refresh tokens, so two concurrent refreshes race and
// one loses.
const REFRESH_WITHIN_SECONDS = 120
let refreshing: Promise<string | null> | null = null

/** Settle a refresh if one is due, so the next read carries a live bearer. */
export function primeBearer(): Promise<string | null> {
  if (!refreshing) {
    refreshing = iamValidAccessToken().finally(() => {
      refreshing = null
    })
  }
  return refreshing
}

/** The stored bearer, kicking a background refresh once it nears expiry. */
function bearer(): string | undefined {
  const token = iamAccessToken()
  if (!token) return undefined
  // null = the token carries no `exp`, is unparseable, or is already past it —
  // every one of those needs a refresh, same as nearing expiry.
  const secs = iamExpiresInSeconds()
  if (secs === null || secs <= REFRESH_WITHIN_SECONDS) void primeBearer()
  return token
}

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
  // Read through a function, not captured once: this module is a singleton built at
  // import time, when the visitor is not signed in yet and the token does not exist.
  // The client calls this at flush time, so a sign-in — and every silent refresh
  // after it — is picked up with no rebuild. Returns undefined on the server and
  // when signed out, which is the anonymous path.
  getToken: bearer,
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
// one stream. What makes those component events CREDENTIALED is `getToken` above —
// the visitor's own IAM bearer — NOT the same-origin session cookie, which carries
// no principal cloud will resolve (see the note above). `AnalyticsProvider` in
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
