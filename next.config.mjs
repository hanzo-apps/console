import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

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
  // way Gui is.
  return ['@hanzo/gui', '@hanzo/iam-js-sdk', '@hanzo/dash', '@hanzo/data', 'react-native-web', ...scoped]
}

/**
 * Same-origin `/v1/*` for the AI product surface — ZERO client-visible prefix.
 *
 * The CTO contract is "no prefix before /v1/ in any API call": the browser calls
 * its OWN origin at a clean `/v1/<head>/...`, never `/cloud/...` or `/ai/...`.
 * These rewrites map exactly the AI-surface heads to the console's already-hardened
 * server-side bearer proxies (`app/cloud`, `app/ai`) — so the URL the client builds
 * is `/v1/prompts` while the request still terminates at OUR Next origin, which
 * mints a short-lived user bearer and forwards it (the raw session cookie NEVER
 * reaches cloud-api, so cloud-api carries no cookie-CSRF surface). This gives the
 * one-endpoint-form goal WITHOUT weakening the bearer trust boundary.
 *
 * Scope is deliberately the CLOSED head list the AI clients use (prompts/agents/
 * evals via /cloud, models/chat/embeddings/rerank via /ai) — a blanket `/v1/:path*`
 * would shadow paths meant for other backends. Each destination handler still
 * enforces its own least-privilege allow-list (`proxy-allow.ts`), so a rewrite can
 * never widen what the proxy admits. `beforeFiles` so these win over any route.
 *
 * The admin AGGREGATE reads (`/v1/admin/{overview,usage,orgs,audit,products}` — the
 * cross-tenant business/platform board) map to the GLOBAL-ADMIN-GATED proxy
 * (`app/admin/aggregate`), which runs `getAdminGate` (fail-closed 403) BEFORE
 * forwarding. This is the console-side server gate for the all-orgs god view (RED
 * H1) — NOT the ungated `/cloud` proxy. `admin/iam` + `admin/kms` are deliberately
 * NOT rewritten here: they keep their own gated proxies with their own tenant
 * scoping, and are reached by the client's explicit `/admin/*` origin path.
 */
const CLOUD_V1_HEADS = ['prompts', 'agents', 'evals', 'analytics', 'templates', 'projects', 'platform', 'crm', 'ml', 'vpcs', 'load-balancers', 'networks', 'mesh', 'edge', 'indexers', 'oracles', 'authz', 'o11y', 'websearch', 'enablement']
const AI_V1_HEADS = ['models', 'chat', 'embeddings', 'rerank', 'audio', 'images', 'videos']
// The admin aggregate heads rewritten to the GLOBAL-ADMIN-GATED proxy. `providers`
// is the AI-provider control board — its GET (the list) AND its POST mutations
// (`providers/toggle`, `providers/primary`) both match the `/:path*` rewrite below,
// which is method-agnostic (Next matches on the URL), so POST is covered without a
// second entry. Keep this in sync with `admin-aggregate.ts` ADMIN_AGGREGATE_HEADS.
const ADMIN_V1_HEADS = ['overview', 'usage', 'orgs', 'audit', 'products', 'finance', 'compute', 'providers', 'customers', 'revenue', 'analytics', 'enablement']
/**
 * DEV-ONLY: proxy the client's direct-cloud `/v1/{iam,o11y}/*` calls (get-account,
 * annotation-queues/users) to a real cloud backend so `npm run dev` renders the
 * authenticated shell locally. Enabled ONLY when `DEV_CLOUD_ORIGIN` is set (never in
 * the built image), so production is unchanged — there the console host's edge routes
 * `/v1` to cloud-api. The request cookie is forwarded by the rewrite, so the local
 * dev session resolves against the real cloud.
 */
const DEV_CLOUD_ORIGIN = process.env.DEV_CLOUD_ORIGIN?.replace(/\/+$/, '')
const devCloudRewrites = () =>
  DEV_CLOUD_ORIGIN
    ? [
        { source: '/v1/iam/:path*', destination: `${DEV_CLOUD_ORIGIN}/v1/iam/:path*` },
        { source: '/v1/o11y/:path*', destination: `${DEV_CLOUD_ORIGIN}/v1/o11y/:path*` },
      ]
    : []

// Native cloud INFRA + managed-data heads the data-product clients call at a clean
// `/v1/<head>` (nothing before /v1/); each is rewritten to the same-origin user-
// bearer `/cloud` proxy (app/cloud) — which mints a per-user token and forwards to
// cloud-api — and is allow-listed in proxy-allow.ts CLOUD_HEADS (defense in depth).
const CLOUD_INFRA_V1_HEADS = ['machines', 'gpus', 'clusters', 'org', 'sql', 'vector', 'datastore', 'kv', 'search', 's3', 'docdb']
// Public compute CATALOG (regions / CPU sizes) → the same-origin visor `/vm` proxy
// (app/vm). The GPU-accelerator catalog is the DISTINCT head `/v1/gpu-sizes` so it
// never collides with the cloud-api GPU INVENTORY at `/v1/gpus`.
const VM_V1_HEADS = ['regions', 'sizes']

const aiSurfaceRewrites = () => ({
  beforeFiles: [
    ...CLOUD_V1_HEADS.map((h) => ({ source: `/v1/${h}`, destination: `/cloud/v1/${h}` })),
    ...CLOUD_V1_HEADS.map((h) => ({ source: `/v1/${h}/:path*`, destination: `/cloud/v1/${h}/:path*` })),
    ...AI_V1_HEADS.map((h) => ({ source: `/v1/${h}`, destination: `/ai/v1/${h}` })),
    ...AI_V1_HEADS.map((h) => ({ source: `/v1/${h}/:path*`, destination: `/ai/v1/${h}/:path*` })),
    ...ADMIN_V1_HEADS.map((h) => ({ source: `/v1/admin/${h}`, destination: `/admin/aggregate/${h}` })),
    ...ADMIN_V1_HEADS.map((h) => ({ source: `/v1/admin/${h}/:path*`, destination: `/admin/aggregate/${h}/:path*` })),
    // Data-product clients (compute / visor / platform / provisioning / storage) —
    // clean `/v1/<head>` → the user-bearer `/cloud` proxy (org from the Bearer owner).
    ...CLOUD_INFRA_V1_HEADS.map((h) => ({ source: `/v1/${h}`, destination: `/cloud/v1/${h}` })),
    ...CLOUD_INFRA_V1_HEADS.map((h) => ({ source: `/v1/${h}/:path*`, destination: `/cloud/v1/${h}/:path*` })),
    // Public compute catalog → the visor `/vm` proxy.
    ...VM_V1_HEADS.map((h) => ({ source: `/v1/${h}`, destination: `/vm/v1/${h}` })),
    ...VM_V1_HEADS.map((h) => ({ source: `/v1/${h}/:path*`, destination: `/vm/v1/${h}/:path*` })),
    { source: `/v1/gpu-sizes`, destination: `/vm/v1/gpus` },
    // Per-tenant billing DATA → the service-token commerce proxy (app/billing/v1).
    { source: `/v1/billing/:path*`, destination: `/billing/v1/:path*` },
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
 *     models/chat/embeddings/…, admin/*), which is exactly what the rewrites used
 *     to forward to via the Next BFF. The BFF proxy routes (app/cloud, app/ai,
 *     app/commerce, …) are the server, and in one-binary the cloud binary IS the
 *     server — so they are simply absent from the export (see below).
 *   - `images.unoptimized` — the export has no Image Optimization server.
 *
 * PRECONDITION for a clean `output:'export'`: the app/ tree must contain NO dynamic
 * server route handlers (a static export has no server runtime to run them).
 * Those handlers are the BFF proxies + the two standalone routes; the latter
 * (keys/onboard) are ported to cloud `/v1/console/*`, and the proxies collapse to
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
  env: { NEXT_PUBLIC_APP_VERSION: pkgVersion },
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
