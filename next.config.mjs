import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

import { resolveBuildId, readGitSha } from './src/config/build-id.mjs'

/**
 * Hanzo Cloud Console — Next.js config.
 *
 * Hanzo GUI is consumed at runtime (no optimizing compiler): we transpile the Gui
 * ESM packages with Next's built-in `transpilePackages` and let `GuiProvider`
 * inject CSS at runtime. Gui is designed to work this way — the compiler is an
 * optimization, not a requirement.
 *
 * (The original reason to avoid `@hanzogui/next-plugin` no longer holds: the loader
 * it depends on was unpublished at 7.3.0, but 8.x renamed it to `@hanzogui/loader`
 * and both now ship. Adopting the compiler is therefore a live option — as an
 * optimization to measure, not a correctness fix, so it is deliberately not bundled
 * into the 8.x convergence.)
 *
 * `react-native` is aliased to `react-native-web` for the browser (Turbopack).
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
 *   - AI gateway heads (models/chat/embeddings/rerank/… + pricing/plan) → `/ai`.
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
// `pricing` (the rich model+provider CATALOG at `/v1/pricing/models`) and `plan` (the
// subscription tiers/entitlements) are AI-gateway-served like models/chat and are in the
// `/ai` proxy ALLOWED set (app/ai/[...path]), so they route to `/ai` too.
// `ai` is the whole hanzoai/ai surface — connections, the router config (`/v1/ai/router/*`),
// the super-admin OrgSettings noun (`/v1/ai/org/settings[/list]`) and the training-contribution
// flag all answer under it, so ONE head carries them. It is not a cloud-api head, so it never
// shadows a cloud surface. The heads those routes used to need — `router`, `org`,
// `get-/update-training-contribution` — are gone with the addresses.
// `training` is the interactive (Tinker-style) engine head (`/v1/training/clients[/*]`) — the
// live LoRA client plane, allow-listed in the `/ai` proxy, likewise never a cloud-api head.
const AI_V1_HEADS = ['models', 'chat', 'embeddings', 'rerank', 'audio', 'images', 'videos', 'pricing', 'plan', 'ai', 'training']
// The admin aggregate heads rewritten to the GLOBAL-ADMIN-GATED proxy. `providers`
// is the AI-provider control board — its GET (the list) AND its POST mutations
// (`providers/toggle`, `providers/primary`) both match the `/:path*` rewrite below,
// which is method-agnostic (Next matches on the URL), so POST is covered without a
// second entry. Keep this in sync with `admin-aggregate.ts` ADMIN_AGGREGATE_HEADS.
const ADMIN_V1_HEADS = ['overview', 'usage', 'orgs', 'audit', 'products', 'finance', 'compute', 'o11y', 'providers', 'customers', 'revenue', 'analytics', 'pricing', 'grants', 'referrals', 'affiliates', 'authors', 'treasury', 'services', 'promos', 'caps', 'volumes']
/**
 * DEV-ONLY: proxy the client's direct-cloud `/v1/{iam,o11y}/*` calls (get-account,
 * reviews/users) to a real cloud backend so `npm run dev` renders the
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
// (`app/v1/vm/[...path]`, which reads visor's OWN spelling). The GPU-accelerator catalog
// is the DISTINCT head `/v1/gpu-sizes`, so it never collides with the cloud-api GPU
// INVENTORY, which is a per-org shape and answers at `/v1/visor/gpus` (served by `/v1`).
const VM_V1_HEADS = ['regions', 'sizes']

const aiSurfaceRewrites = () => ({
  beforeFiles: [
    // Cloud-api heads (prompts/agents/auto/functions/framework/s3/provisioning/…) are
    // NOT rewritten: a clean `/v1/<head>` falls through to the `app/v1/[...path]` bearer
    // proxy → cloud-api `/v1/*`. Only the NON-cloud backends are dispatched below.
    // Client builds a clean `/v1/<aihead>`; dispatch to the `/ai` bearer proxy WITHOUT a
    // nested version in the target — `app/ai/[...path]` re-roots the upstream at `v1/`
    // (`isAllowedAiPath`/the gateway see `v1/<aihead>`), so no nested version leaks anywhere.
    ...AI_V1_HEADS.map((h) => ({ source: `/v1/${h}`, destination: `/ai/${h}` })),
    ...AI_V1_HEADS.map((h) => ({ source: `/v1/${h}/:path*`, destination: `/ai/${h}/:path*` })),
    // The super-admin OrgSettings noun needs no rule of its own any more: it answers at
    // `/v1/ai/org/settings[/list]`, so the `ai` head above dispatches it. Its old address
    // took a TARGETED rule to keep a broad `org` head from hijacking the platform
    // `/v1/org/{org}/cluster|domain|…` surface, which still falls through to the `/v1` BFF.
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
  // AGENTS.md is a symlink to the tracked LLM.md, and Next appends its own rules
  // block to it on every dev/build run. Several sessions share this tree; a build
  // step that dirties a tracked file gets swept into someone else's commit.
  agentRules: false,
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
    // Run the typecheck through the local `tsc` BINARY instead of TypeScript's
    // JavaScript API. TypeScript 7 is a different engine and publishes no such
    // API, so Next's default backend reads nothing from it — the typecheck goes
    // quietly absent while the build stays green. Next added this switch for
    // exactly that (vercel/next.js#95639).
    useTypeScriptCli: true,
  },
  // Module resolution, in ONE place. `next build --webpack` names the bundler
  // (Next 16 defaults to Turbopack, which this app cannot use yet — see
  // scripts/build-embed.mjs for the measured reason), so this is the only
  // resolver config and there is no second copy to drift from.
  webpack(config) {
    // `~/…` is this app's own source, resolved HERE rather than inferred. Next
    // derives its aliases by reading tsconfig `paths` through whichever
    // `typescript` is installed, and TypeScript 7 — a different engine, with no
    // JavaScript API — hands it nothing: every `~/config`, `~/lib/router` and
    // `~/components/*` went unresolvable at once while the typecheck stayed
    // green, because tsc resolves `paths` itself and never asks the bundler.
    config.resolve.alias = {
      ...config.resolve.alias,
      '~': resolve(__dirname, 'src'),
      // Exact match only (`$`): the bare specifier means react-native-web on the
      // web, while a deep `react-native/Libraries/*` import keeps resolving to
      // the real package, which is what its own `.web.js` files expect.
      'react-native$': 'react-native-web',
    }
    // @hanzo/ui is consumed from SOURCE via a workspace link. Keep the symlinked
    // path so its own imports walk up into the CONSOLE's node_modules — one gui
    // instance. Resolving the realpath loads a second copy and breaks theme context.
    config.resolve.symlinks = false
    config.resolve.extensions = ['.web.tsx', '.web.ts', '.web.jsx', '.web.js', ...config.resolve.extensions]
    return config
  },
}

export default nextConfig
