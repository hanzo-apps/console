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
 *     two standalone routes (keys/onboard) now ported to cloud `/v1/console/*`.
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
 * Steps: stash route handlers → overlay dynamic pages → `CONSOLE_EMBED=1 next build`
 * (emits out/) → restore everything.
 */
import { execFileSync } from 'node:child_process'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
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
 *   - `generateStaticParams` returns ONE placeholder param (output:export requires a
 *     non-empty set) keyed to the segment; a catch-all takes an array value.
 *   - `dynamicParams = false`: no on-demand params (there is no server); everything
 *     else is the SPA fallback. The real body lives beside this as `_body.tsx`.
 */
function wrapperSource(seg, catchAll) {
  const value = catchAll ? `['index']` : `'index'`
  return `// AUTO-GENERATED for \`output: 'export'\` by scripts/build-embed.mjs — do not commit.
// The real (client) page body is ./_body.tsx (still bundled → client nav hydrates it);
// this server wrapper only satisfies the static-export contract. See the script.
import Body from './_body'

export const dynamic = 'force-static'
export const dynamicParams = false
export function generateStaticParams() {
  return [{ ${seg}: ${value} }]
}
export default function Page(props: any) {
  return <Body {...props} />
}
`
}

const routes = existsSync(appDir) ? findFiles(appDir, /^route\.(ts|tsx|js)$/) : []
const dynamicPages = existsSync(appDir) ? findFiles(appDir, /^page\.tsx$/).filter(isDynamicPage) : []

const stashedRoutes = []
const wrappedPages = [] // { page, body }

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

  console.log(
    `[build:embed] stashed ${stashedRoutes.length} route handler(s), wrapped ${wrappedPages.length} dynamic page(s); building static export…`,
  )

  // The project pins Next 15 (webpack is its default builder; the custom `webpack()`
  // config in next.config.mjs applies). No Turbopack flag is passed.
  execFileSync('npx', ['next', 'build'], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, CONSOLE_EMBED: '1' },
  })

  const out = join(root, 'out')
  if (!existsSync(out) || !statSync(out).isDirectory()) {
    throw new Error('next build did not emit out/ (static export failed)')
  }
  console.log('[build:embed] static export ready at out/')
} finally {
  // ALWAYS restore: remove wrappers + _body, put the original page back; un-stash routes.
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
