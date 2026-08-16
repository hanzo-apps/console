#!/usr/bin/env node
/**
 * build-embed.mjs — produce the STATIC console bundle the hanzoai/cloud Go binary
 * go:embeds (task #41, "True 1-binary FE"). Invoked by `npm run build:embed`.
 *
 * A Next `output: 'export'` build imposes two constraints this app does not meet on
 * `main` (it is a server build there). This script makes the app export-clean for
 * the duration of ONE build and ALWAYS restores it (a finally block; in CI the
 * checkout is disposable, locally it keeps the tree pristine), so nothing on `main`
 * and the normal `npm run build` are unaffected:
 *
 *  1) NO server route handlers. A static export has no runtime to run an
 *     app/route.ts. This repo's route handlers are (a) BFF reverse-proxies that in
 *     one-binary collapse to the cloud `/v1/*` the SPA calls directly, and (b) the
 *     two standalone routes (keys/onboard) now ported to cloud `/v1/iam/{keys,onboard}`.
 *     Either way they must be absent from the export → we STASH them.
 *
 *  2) Every dynamic page segment needs `generateStaticParams()`. The console's two
 *     dynamic pages ([...slug] and discover/[id]) are `'use client'` catch-alls that
 *     resolve their view CLIENT-side from the product registry — so the correct
 *     static-export shape is "pre-render NONE; serve the SPA shell for every deep
 *     link" (cloud/webui.go's serveIndex is exactly that fallback). A `'use client'`
 *     module may not itself export the server-only generateStaticParams, so we
 *     OVERLAY each dynamic page with a tiny SERVER wrapper (generateStaticParams →
 *     [] + dynamicParams=false) that renders the original client body, which we move
 *     beside it as `_body.tsx` (a leading-underscore dir/file is not a route).
 *
 *  3) NO request-time dynamic API in the ROOT LAYOUT. `output: 'export'` prerenders
 *     EVERY page THROUGH app/layout.tsx, so a request-time read there — the root
 *     `generateMetadata` calling `headers()` for a per-host <title> — throws in the
 *     Server Components render for ALL pages (it surfaces on /_not-found and aborts
 *     the export). The embed is same-origin and resolves brand CLIENT-side from
 *     window.location, so the SSR title can safely fall back to the build-time
 *     default; the browser re-renders the correct brand. So we NEUTRALIZE the
 *     layout's `next/headers` read for the export (drop the import, host → undefined)
 *     and restore the pristine layout after. Without this, the export FAILS and the
 *     cloud image degrades to the committed fallback shell (the 1-binary console
 *     silently ships as a stub).
 *
 * Steps: stash route handlers → overlay dynamic pages → neutralize root-layout
 * dynamic APIs → `CONSOLE_EMBED=1 next build` (emits out/) → restore everything.
 */
import { execFileSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const appDir = join(root, 'app')
const stashDir = join(root, '.embed-stash')

/** Recursively collect files under dir whose basename matches re. */
function findFiles(dir, re) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...findFiles(p, re))
    else if (re.test(entry.name)) out.push(p)
  }
  return out
}

/** Move a file, creating the destination's parent dirs. */
function move(from, to) {
  mkdirSync(dirname(to), { recursive: true })
  renameSync(from, to)
}

/** The dynamic segment of a page dir: `[id]` → "id", `[...slug]` → "slug", or "". */
function dynamicSegment(file) {
  const m = basename(dirname(file)).match(/^\[(?:\.\.\.)?([^\]]+)\]$/)
  return m ? m[1] : ''
}

/** Whether the dir name is a catch-all (`[...seg]`) vs a single segment (`[seg]`). */
function isCatchAll(file) {
  return /^\[\.\.\./.test(basename(dirname(file)))
}

/** A dynamic page needing generateStaticParams under output:export. */
function isDynamicPage(file) {
  return basename(file) === 'page.tsx' && dynamicSegment(file) !== ''
}

/**
 * The server wrapper written in place of a dynamic client page for the export.
 *
 *   - `dynamic = 'force-static'`: the export prerender step treats the body's
 *     dynamic reads (use(params)/searchParams) as static — it renders a placeholder
 *     instead of throwing. The route's REAL client component still ships in the JS
 *     bundle, so client-side navigation hydrates the true page; direct deep links
 *     hit the embedding host's SPA fallback (cloud/webui.go serveIndex → index.html)
 *     which re-resolves the route client-side.
 *   - `generateStaticParams` returns ONE placeholder. It used to return every route
 *     the registry states, because the generated set was what decided whether a
 *     client navigation stayed client-side — an unknown param hard-navigated, and
 *     the app rendered twice. `src/lib/router.ts` moved that decision: navigation
 *     is `history.pushState`, which never asks Next whether a route exists, so the
 *     enumeration stopped being load-bearing while still costing what it always did.
 *     It cost the release: ~373KB of identical shell per route, 289 HTML files and
 *     82MB, against a 16 MiB ceiling on the one request that uploads a release. So
 *     the export could not publish at all — the ONE thing it exists to do.
 *   - `dynamicParams = false`: no on-demand params (there is no server); everything
 *     else is the SPA fallback. The real body lives beside this as `_body.tsx`.
 */
function wrapperSource(seg, catchAll) {
  const params = `{ ${seg}: ${catchAll ? `['index']` : `'index'`} }`
  return `// AUTO-GENERATED for \`output: 'export'\` by scripts/build-embed.mjs — do not commit.
// The real (client) page body is ./_body.tsx (still bundled → client nav hydrates it);
// this server wrapper only satisfies the static-export contract. See the script.
import Body from './_body'

export const dynamic = 'force-static'
export const dynamicParams = false
export function generateStaticParams() {
  return [${params}]
}
export default function Page(props: any) {
  return <Body {...props} />
}
`
}

/**
 * Rewrite the root layout to be export-clean: `output: 'export'` prerenders EVERY
 * page through app/layout.tsx, so a request-time dynamic API there (next/headers'
 * `headers()`) throws in the Server Components render for ALL pages and aborts the
 * export (it surfaces on /_not-found). The root `generateMetadata` reads the Host
 * header only to brand the SSR <title>; in the same-origin embed the brand is
 * resolved CLIENT-side from window.location, so we drop the `next/headers` import
 * and resolve the host to `undefined` (→ the build-time default brand; the browser
 * re-renders the correct brand). Returns the pristine source (to restore in the
 * finally), or null when the layout has no request-time read to neutralize.
 */
function neutralizeLayout(file) {
  if (!existsSync(file)) return null
  const src = readFileSync(file, 'utf8')
  if (!/from ['"]next\/headers['"]/.test(src)) return null
  const patched = src
    .replace(/^\s*import\s*\{[^}]*\}\s*from\s*['"]next\/headers['"];?[^\n]*\n/m, '')
    .replace(/\(await\s+headers\(\)\)\.get\([^)]*\)\s*\?\?\s*undefined/g, 'undefined')
    .replace(/\(await\s+headers\(\)\)\.get\([^)]*\)/g, 'undefined')
  writeFileSync(file, patched, 'utf8')
  return src
}

const routes = existsSync(appDir) ? findFiles(appDir, /^route\.(ts|tsx|js)$/) : []
const dynamicPages = existsSync(appDir) ? findFiles(appDir, /^page\.tsx$/).filter(isDynamicPage) : []

const stashedRoutes = []
const wrappedPages = [] // { page, body }
const layoutFile = join(appDir, 'layout.tsx')
let layoutPristine = null // pristine app/layout.tsx source while neutralized for the export

if (existsSync(stashDir)) rmSync(stashDir, { recursive: true, force: true })

try {
  // 1) Stash server route handlers out of the export.
  for (const r of routes) {
    const rel = relative(appDir, r)
    move(r, join(stashDir, 'routes', rel))
    stashedRoutes.push(rel)
  }

  // 2) Overlay each dynamic page: keep a copy of the original, move the original to
  //    _body.tsx, write the server wrapper as page.tsx.
  for (const page of dynamicPages) {
    const rel = relative(appDir, page)
    const pristine = join(stashDir, 'pages', rel)
    const body = join(dirname(page), '_body.tsx')
    mkdirSync(dirname(pristine), { recursive: true })
    copyFileSync(page, pristine) // pristine original for restore
    renameSync(page, body) // client body → non-route sibling
    writeFileSync(page, wrapperSource(dynamicSegment(page), isCatchAll(page)), 'utf8')
    wrappedPages.push({ page, body })
  }

  // 3) Neutralize the root layout's request-time dynamic APIs (next/headers) so the
  //    export prerender doesn't throw for every page through the layout.
  layoutPristine = neutralizeLayout(layoutFile)

  console.log(
    `[build:embed] stashed ${stashedRoutes.length} route handler(s), wrapped ${wrappedPages.length} dynamic page(s)${
      layoutPristine ? ', neutralized root-layout headers()' : ''
    }; building static export…`,
  )

  // Next 16 defaults to Turbopack, so the bundler is NAMED rather than inherited.
  // Turbopack does not build this app yet, for one measured reason: react-native-svg
  // imports `TurboModuleRegistry` from `react-native`, which react-native-web does
  // not export, and the alias that makes RN mean RNW on the web is what surfaces it.
  // That is an interop gap in the dependency, not a config mistake — so webpack is
  // the bundler until it closes, and saying so beats discovering it in CI.
  execFileSync('npx', ['next', 'build', '--webpack'], {
    cwd: root,
    stdio: 'inherit',
    // CONSOLE_EMBED gates the server-side build transforms; NEXT_PUBLIC_CONSOLE_EMBED
    // is inlined into the CLIENT bundle so runtime code (lib/embed.ts → IS_EMBED) can
    // skip the BFF-only session probes (/auth/refresh|session) that don't exist in
    // this static, server-less deployment.
    env: { ...process.env, CONSOLE_EMBED: '1', NEXT_PUBLIC_CONSOLE_EMBED: '1' },
  })

  const out = join(root, 'out')
  if (!existsSync(out) || !statSync(out).isDirectory()) {
    throw new Error('next build did not emit out/ (static export failed)')
  }
  console.log('[build:embed] static export ready at out/')
} finally {
  // ALWAYS restore: put the pristine root layout back; remove wrappers + _body, put
  // the original page back; un-stash routes.
  if (layoutPristine != null) writeFileSync(layoutFile, layoutPristine, 'utf8')
  for (const { page, body } of wrappedPages) {
    if (existsSync(body)) rmSync(body, { force: true })
    const rel = relative(appDir, page)
    const pristine = join(stashDir, 'pages', rel)
    if (existsSync(pristine)) {
      rmSync(page, { force: true })
      move(pristine, page)
    }
  }
  for (const rel of stashedRoutes) move(join(stashDir, 'routes', rel), join(appDir, rel))
  if (existsSync(stashDir)) rmSync(stashDir, { recursive: true, force: true })
  if (stashedRoutes.length || wrappedPages.length) {
    console.log(
      `[build:embed] restored ${stashedRoutes.length} route handler(s) + ${wrappedPages.length} dynamic page(s)`,
    )
  }
}
