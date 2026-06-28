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
  return ['@hanzo/gui', '@hanzo/iam-js-sdk', 'react-native-web', ...scoped]
}

/**
 * Strict security headers for every response (the ONE place they are set).
 *
 * CSP closes the high-value vectors: `frame-ancestors 'none'` kills clickjacking
 * (+ X-Frame-Options: DENY for legacy UAs), `object-src 'none'` plugins,
 * `base-uri 'self'` base-tag hijack, scoped `form-action`/`connect-src` limit
 * credential/data exfil to the Hanzo/Lux/Zoo/Pars brand backends, HSTS forces TLS,
 * nosniff stops MIME confusion, and Referrer-Policy stops URL leakage.
 *
 * `script-src` uses `'unsafe-inline'` (NOT a nonce): console2's pages are
 * statically prerendered, so Next cannot inject a per-request nonce into the
 * static HTML — a nonce+`strict-dynamic` policy blocks every script and
 * white-screens the app. Nonce-strict CSP would require forcing dynamic rendering
 * app-wide; tracked as a follow-up. console2 renders all data as escaped React
 * text (no HTML-injection sink it introduces), so the residual XSS surface is low
 * and the remaining directives still contain any exploit.
 */
const CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self' https://hanzo.id https://lux.id https://zoolabs.id https://pars.id",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.hanzo.ai https://*.hanzo.network https://hanzo.id https://*.lux.cloud https://*.lux.network https://lux.id https://*.zoo.cloud https://*.zoo.ngo https://*.zoo.network https://zoolabs.id https://*.pars.cloud https://*.pars.network https://pars.id",
  "frame-src 'self'",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
].join('; ')

const SECURITY_HEADERS = [
  { key: 'Content-Security-Policy', value: CSP },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-DNS-Prefetch-Control', value: 'off' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), browsing-topics=()' },
]

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Drop the `X-Powered-By: Next.js` fingerprint (no framework disclosure).
  poweredByHeader: false,
  transpilePackages: guiPackages(),
  experimental: {
    esmExternals: true,
  },
  async headers() {
    return [{ source: '/(.*)', headers: SECURITY_HEADERS }]
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
