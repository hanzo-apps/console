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
  // @hanzo/dashboard ships its screens as ESM/TSX source (no compiled
  // dist) so the shared Base UI is transpiled here the same way Gui is.
  return ['@hanzo/gui', '@hanzo/iam-js-sdk', '@hanzo/dashboard', 'react-native-web', ...scoped]
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
