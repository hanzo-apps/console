import { readdirSync } from 'node:fs'
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
 * STATIC EXPORT — the console ships as a static SPA that the hanzoai/cloud Go
 * binary `go:embed`s and serves at `/` from the SAME process that serves `/v1`
 * (see hanzoai/cloud webui.go). `next build` with `output: 'export'` emits `out/`;
 * the Dockerfile `build:embed` stage copies it into the Go embed path.
 *
 * There is no Next server in this build — no BFF bearer-proxy routes, no rewrites.
 * The browser calls its OWN origin at a clean `/v1/<head>/...` and that request is
 * served DIRECTLY by the cloud binary, which validates the first-party IAM session
 * cookie (`iam_access_token`) and derives the org from its `owner` claim
 * (hanzoai/cloud middleware_identity.go). Same origin ⇒ the cookie is first-party,
 * so no cross-origin bearer mint is needed — the whole point of the old BFF
 * collapses by construction. All API base URLs resolve to same-origin `/v1`
 * (src/lib/api/client.ts); CSRF is covered by the session cookie's SameSite plus
 * the API's own mutating-request origin checks.
 */

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Static SPA export — one artifact the Go binary embeds. No Node server ships.
  output: 'export',
  // A static export has no Next image-optimizer server; serve images as-is.
  images: { unoptimized: true },
  transpilePackages: guiPackages(),
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
