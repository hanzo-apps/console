// The embedded `@hanzo/iam` BrowserIamSdk uses `proxyBaseUrl = /v1/iam`, so its
// `handleCallback()` POSTs the OAuth authorization code to
// `${proxyBaseUrl}/oauth/token`. The token-exchange handler (code -> tokens ->
// signed `hi_session` cookie) lives at `../auth/token`. Expose it at the
// canonical `/v1/iam/oauth/token` path the SDK actually calls (middleware maps
// `/v1/iam/oauth/token` -> `/api/public/iam/oauth/token`). Without this route the
// authorization code is never exchanged, no `hi_session` is set, and SSO login
// bounces back to `/auth/sign-in`.
import handler from "../auth/token";

export default handler;
