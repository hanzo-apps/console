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
const CLOUD_V1_HEADS = ['prompts', 'agents', 'evals', 'analytics', 'templates', 'projects', 'crm', 'vpcs', 'load-balancers', 'networks', 'mesh', 'edge']
const AI_V1_HEADS = ['models', 'chat', 'embeddings', 'rerank', 'audio']
const ADMIN_V1_HEADS = ['overview', 'usage', 'orgs', 'audit', 'products', 'finance', 'compute']
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

const aiSurfaceRewrites = () => ({
  beforeFiles: [
    ...CLOUD_V1_HEADS.map((h) => ({ source: `/v1/${h}`, destination: `/cloud/v1/${h}` })),
    ...CLOUD_V1_HEADS.map((h) => ({ source: `/v1/${h}/:path*`, destination: `/cloud/v1/${h}/:path*` })),
    ...AI_V1_HEADS.map((h) => ({ source: `/v1/${h}`, destination: `/ai/v1/${h}` })),
    ...AI_V1_HEADS.map((h) => ({ source: `/v1/${h}/:path*`, destination: `/ai/v1/${h}/:path*` })),
    ...ADMIN_V1_HEADS.map((h) => ({ source: `/v1/admin/${h}`, destination: `/admin/aggregate/${h}` })),
    ...ADMIN_V1_HEADS.map((h) => ({ source: `/v1/admin/${h}/:path*`, destination: `/admin/aggregate/${h}/:path*` })),
    ...devCloudRewrites(),
  ],
})

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: { NEXT_PUBLIC_APP_VERSION: pkgVersion },
  transpilePackages: guiPackages(),
  rewrites: aiSurfaceRewrites,
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
