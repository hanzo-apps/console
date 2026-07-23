import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

import { resolveBuildId, readGitSha } from './src/config/build-id.mjs'

/**
 * Hanzo Cloud Console — Next.js config.
 *
 * Hanzo GUI is consumed at runtime (no optimizing compiler): the published
 * `@hanzogui/next-plugin` has a broken npm dependency (`hanzogui-loader@7.3.0`
 * is unpublished; the available fork renames its exports), so we transpile the
 * Gui ESM packages with Next's built-in `transpilePackages` and let
 * `GuiProvider` inject CSS at runtime. Gui is designed to work this way — the
 * compiler is an optimization, not a requirement.
 *
 * `react-native` is aliased to `react-native-web` for the browser.
 *
 * The v5 config sets `onlyShorthandStyleProps`, so components use Gui shorthand
 * props (p/px/items/justify/...). `tsc --noEmit` passes clean, so the build
 * type-checks too (no error suppression).
 */
const __dirname = dirname(fileURLToPath(import.meta.url))

// Single source of the app version: package.json. Exposed to the browser as
// NEXT_PUBLIC_APP_VERSION so the shell can render the shared "Hanzo Cloud <MAJOR.MINOR>"
// product-release label (console app-semver; cloud ships its own Go v1.x under the
// same umbrella). No second place holds the version.
const pkgVersion = JSON.parse(readFileSync(join(__dirname, 'package.json'), 'utf8')).version

/** Every installed `@hanzogui/*` package, discovered (not hardcoded). */
function guiPackages() {
  const dir = join(__dirname, 'node_modules', '@hanzogui')
  let scoped = []
  try {
    scoped = readdirSync(dir).map((name) => `@hanzogui/${name}`)
  } catch {
    scoped = []
  }
  // @hanzo/dash and @hanzo/data ship their screens/components as ESM/TSX
  // source (no compiled dist), so the shared Base UI is transpiled here the same
  // way Gui is. @hanzo/usage ships its <UsagePanel> (`/react`) as TSX source for the
  // same reason (its headless core `.`/`/node` are compiled dist and pass through).
  // @hanzo/ui (v8, the shared shell: AppHeader/BrandMark/OrgSwitcher/orgScope)
  // also ships raw TS source.
  return ['@hanzo/gui', '@hanzo/iam-js-sdk', '@hanzo/dash', '@hanzo/data', '@hanzo/canvas', '@hanzo/finance-ui', '@hanzo/usage', '@hanzo/ui', 'react-native-web', ...scoped]
}

/**
 * Same-origin `/v1/*` — ZERO client-visible prefix (the CTO contract: "no prefix
 * before /v1/ in any API call"). The browser ALWAYS calls its OWN origin at a clean
 * `/v1/<head>/...`, never `/cloud/...`, `/ai/...` or `/api/...`.
 *
 * The DEFAULT terminus for a `/v1/<head>` call is the console's `app/v1/[...path]`
 * catch-all bearer proxy (→ cloud-api `/v1/*`): it mints a short-lived user bearer
 * from the session cookie and forwards it, so the raw cookie NEVER reaches cloud-api
 * (no cookie-CSRF surface) and the org is server-authoritative. That handler needs
 * NO rewrite — a clean `/v1/agents` falls straight through to it.
 *
 * These `beforeFiles` rewrites exist ONLY to DISPATCH the heads whose backend is NOT
 * cloud-api to their own hardened same-origin proxy, while keeping the client URL a
 * clean `/v1/...`:
 *   - AI gateway heads (models/chat/embeddings/rerank/… + pricing/plans) → `/ai`.
 *   - Admin AGGREGATE reads/writes (`/v1/admin/{overview,usage,…}`, the cross-tenant
 *     god view) → the GLOBAL-ADMIN-GATED `/admin/aggregate` proxy, which runs
 *     `getAdminGate` (fail-closed 403) BEFORE forwarding (RED H1). `admin/iam` +
 *     `admin/kms` are deliberately NOT rewritten — they keep their own gated proxies,
 *     reached by the client's explicit `/admin/*` origin path.
 *   - Visor compute CATALOG (regions/sizes, and `gpu-sizes` → visor `gpus`) → `/v1/vm`.
 *
 * (Per-tenant billing + commerce store DATA are NOT dispatched here — they are
 * FILESYSTEM routes `app/v1/{billing,commerce}/[...path]`, more specific than the
 * `/v1/[...path]` cloud BFF, so a clean `/v1/billing/*` · `/v1/commerce/*` resolves
 * straight to them with no rewrite.)
 *
 * `beforeFiles` so a dispatched head wins over the `/v1` catch-all; the scope is the
 * CLOSED head list each non-cloud client uses (a blanket `/v1/:path*` would shadow the
 * cloud surface). Each destination handler STILL enforces its own least-privilege
 * allow-list (`proxy-allow.ts`), so a rewrite can never widen what a proxy admits.
 */
// `pricing` (the rich model+provider CATALOG at `/v1/pricing/models`) and `plans` (the
// subscription tiers/entitlements) are AI-gateway-served like models/chat and are in the
// `/ai` proxy ALLOWED set (app/ai/[...path]), so they route to `/ai` too.
// `ai` is the AI Login Manager connections head (`/v1/ai/connections[/*]`) — routed to the
// `/ai` bearer proxy like the rest; it is NOT a cloud-api head (never shadows a cloud surface).
// `training` is the interactive (Tinker-style) engine head (`/v1/training/clients[/*]`) — the
// live LoRA client plane, allow-listed in the `/ai` proxy, likewise never a cloud-api head.
// `router` is the router-config head — `/v1/router/policy` (GET read + PUT write),
// `/v1/router/stats`, and `/v1/router/{defaults,ledger,rewards,artifact-meta}` — all served
// by hanzoai/ai; `get-/update-training-contribution` are the org's opt-in flag. The super-admin
// OrgSettings noun `/v1/org/settings` (GET/PUT/DELETE + `/v1/org/settings/list`) is routed by the
// TARGETED rewrites below rather than an `org` head, because a broad `org` head would hijack the
// platform `/v1/org/{org}/cluster` surface. All are in the `/ai` proxy ALLOWED set (app/ai/[...path]).
const AI_V1_HEADS = ['models', 'chat', 'embeddings', 'rerank', 'audio', 'images', 'videos', 'pricing', 'plans', 'ai', 'training', 'router', 'get-training-contribution', 'update-training-contribution']
// The admin aggregate heads rewritten to the GLOBAL-ADMIN-GATED proxy. `providers`
// is the AI-provider control board — its GET (the list) AND its POST mutations
// (`providers/toggle`, `providers/primary`) both match the `/:path*` rewrite below,
// which is method-agnostic (Next matches on the URL), so POST is covered without a
// second entry. Keep this in sync with `admin-aggregate.ts` ADMIN_AGGREGATE_HEADS.
const ADMIN_V1_HEADS = ['overview', 'usage', 'orgs', 'audit', 'products', 'finance', 'compute', 'o11y', 'providers', 'customers', 'revenue', 'analytics', 'enablement', 'grants', 'referrals', 'affiliates', 'authors', 'treasury', 'services', 'promos', 'spend-caps', 'storage']
/**
 * DEV-ONLY: proxy the client's direct-cloud `/v1/{iam,o11y}/*` calls (get-account,
 * annotation-queues/users) to a real cloud backend so `npm run dev` renders the
 * authenticated shell locally. Enabled ONLY when `DEV_CLOUD_ORIGIN` is set (never in
 * the built image), so production is unchanged — there the console host's edge routes
 * `/v1` to the console, whose `/v1` catch-all forwards to cloud-api. The request cookie
 * is forwarded by the rewrite, so the local dev session resolves against the real cloud.
 */
const DEV_CLOUD_ORIGIN = process.env.DEV_CLOUD_ORIGIN?.replace(/\/+$/, '')
const devCloudRewrites = () =>
  DEV_CLOUD_ORIGIN
    ? [
        { source: '/v1/iam/:path*', destination: `${DEV_CLOUD_ORIGIN}/v1/iam/:path*` },
        { source: '/v1/o11y/:path*', destination: `${DEV_CLOUD_ORIGIN}/v1/o11y/:path*` },
      ]
    : []

// Public compute CATALOG (regions / CPU sizes) → the same-origin visor proxy
// (`app/v1/vm/[...path]`). The GPU-accelerator catalog is the DISTINCT head `/v1/gpu-sizes`
// so it never collides with the cloud-api GPU INVENTORY at `/v1/gpus` (served by `/v1`).
const VM_V1_HEADS = ['regions', 'sizes']

const aiSurfaceRewrites = () => ({
  beforeFiles: [
    // Cloud-api heads (prompts/agents/automations/functions/framework/s3/vector/…) are
    // NOT rewritten: a clean `/v1/<head>` falls through to the `app/v1/[...path]` bearer
    // proxy → cloud-api `/v1/*`. Only the NON-cloud backends are dispatched below.
    // Client builds a clean `/v1/<aihead>`; dispatch to the `/ai` bearer proxy WITHOUT a
    // nested version in the target — `app/ai/[...path]` re-roots the upstream at `v1/`
    // (`isAllowedAiPath`/the gateway see `v1/<aihead>`), so no nested version leaks anywhere.
    ...AI_V1_HEADS.map((h) => ({ source: `/v1/${h}`, destination: `/ai/${h}` })),
    ...AI_V1_HEADS.map((h) => ({ source: `/v1/${h}/:path*`, destination: `/ai/${h}/:path*` })),
    // Super-admin OrgSettings noun → the `/ai` bearer proxy (hanzoai/ai). TARGETED (not an
    // `org` head) so it never shadows the platform `/v1/org/{org}/cluster|domain|…` surface,
    // which keeps falling through to the `/v1` cloud BFF. Covers `/v1/org/settings` and
    // `/v1/org/settings/list` (allow-listed in app/ai/[...path]).
    { source: `/v1/org/settings`, destination: `/ai/org/settings` },
    { source: `/v1/org/settings/:path*`, destination: `/ai/org/settings/:path*` },
    // The SaaS-operations god-view is served by COMMERCE (the money SOT), NOT the
    // cloud aggregate: route /v1/admin/saas to its OWN global-admin-gated commerce
    // proxy (`app/admin/saas`). Placed before the aggregate map so it wins; `saas` is
    // deliberately NOT in ADMIN_V1_HEADS (that list forwards to cloud /v1/admin/*).
    { source: `/v1/admin/saas`, destination: `/admin/saas` },
    ...ADMIN_V1_HEADS.map((h) => ({ source: `/v1/admin/${h}`, destination: `/admin/aggregate/${h}` })),
    ...ADMIN_V1_HEADS.map((h) => ({ source: `/v1/admin/${h}/:path*`, destination: `/admin/aggregate/${h}/:path*` })),
    // Public compute catalog → the visor `app/v1/vm/[...path]` proxy (a bare `/v1/regions`
    // dispatches to the /v1-first vm handler; the visor client also builds `/v1/vm/*` directly).
    ...VM_V1_HEADS.map((h) => ({ source: `/v1/${h}`, destination: `/v1/vm/${h}` })),
    ...VM_V1_HEADS.map((h) => ({ source: `/v1/${h}/:path*`, destination: `/v1/vm/${h}/:path*` })),
    { source: `/v1/gpu-sizes`, destination: `/v1/vm/gpus` },
    // Per-tenant billing DATA + commerce store DATA need NO rewrite: they are FILESYSTEM
    // routes `app/v1/billing/[...path]` (service token) and `app/v1/commerce/[...path]`
    // (user bearer), each MORE SPECIFIC than the `app/v1/[...path]` cloud BFF, so a clean
    // `/v1/billing/*` · `/v1/commerce/*` resolves straight to them (the /v1-first law).
    ...devCloudRewrites(),
  ],
})

/**
 * EMBED MODE (the "True 1-binary FE" target — task #41).
 *
 * `npm run build:embed` sets CONSOLE_EMBED=1 and produces a STATIC EXPORT (`out/`)
 * that the hanzoai/cloud Go binary go:embeds and serves at its own web root. In this
 * mode the console SPA is same-origin with the cloud `/v1` API (config.cloudUrl
 * defaults to window.location.origin), so:
 *
 *   - `output: 'export'` — emit a pure static bundle, no Node server.
 *   - NO `rewrites` — a static export cannot run rewrites, and it does not need
 *     them: the clean `/v1/<head>` calls the SPA already builds now terminate
 *     DIRECTLY at the embedded cloud's mounted subsystems (prompts/agents/evals/…,
 *     models/chat/embeddings/…, admin/*), which is exactly what the rewrites/`app/v1`
 *     proxy forward to via the Next BFF. The BFF proxy routes (app/v1, app/ai,
 *     app/commerce, …) are the server, and in one-binary the cloud binary IS the
 *     server — so they are simply absent from the export (see below).
 *   - `images.unoptimized` — the export has no Image Optimization server.
 *
 * PRECONDITION for a clean `output:'export'`: the app/ tree must contain NO dynamic
 * server route handlers (a static export has no server runtime to run them).
 * Those handlers are the BFF proxies + the two standalone routes; the latter
 * (keys/onboard) are ported to cloud `/v1/iam/{keys,onboard}`, and the proxies collapse to
 * the cloud `/v1/*` the SPA calls directly. The embed build therefore runs against
 * a tree with every app route handler removed (the build:embed script prunes the
 * "route" files into a scratch stash so the server build on `main` is untouched).
 *
 * The normal `npm run build` is UNCHANGED (server build with rewrites) so nothing
 * regresses for the standalone console deployment during the transition.
 */
const EMBED = process.env.CONSOLE_EMBED === '1'

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Deterministic per-commit build id (see src/config/build-id.mjs): pins ONE id
  // across every replica of a release so a rolling deploy never serves one build's
  // HTML against another build's /_next/static/<BUILD_ID>/ path — the chunk-404 the
  // live audit hit. SOURCE_COMMIT (CI build-arg) -> git HEAD -> package version.
  generateBuildId: () => resolveBuildId({ env: process.env, gitSha: readGitSha(__dirname), version: pkgVersion }),
  env: { NEXT_PUBLIC_APP_VERSION: pkgVersion },
  // @hanzo/usage is transpiled (see guiPackages) so its source <UsagePanel> (`/react`)
  // compiles in the client bundle; its headless `.` entry (used by the /ai-accounts
  // server routes) carries no node built-ins, so it needs no server-external treatment.
  transpilePackages: guiPackages(),
  ...(EMBED
    ? { output: 'export', images: { unoptimized: true } }
    : { rewrites: aiSurfaceRewrites }),
  experimental: {
    esmExternals: true,
  },
  webpack(config) {
    config.resolve.alias = {
      ...config.resolve.alias,
      'react-native$': 'react-native-web',
    }
    // Gui flags the platform via this define; web build.
    config.resolve.extensions = [
      '.web.tsx',
      '.web.ts',
      '.web.jsx',
      '.web.js',
      ...config.resolve.extensions,
    ]
    return config
  },
}

export default nextConfig
