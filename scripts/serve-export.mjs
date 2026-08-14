/**
 * Serve `out/` the way production serves the console — so the production topology
 * can be run, and tested, on a laptop.
 *
 * This bug shipped because it could not be reproduced. `next dev` and `next start`
 * are REAL Next servers: they generate an RSC payload for any route on demand, so
 * `router.push` navigates client-side and everything looks right. Production is not
 * that. It is a static bundle behind one rule — serve the file if it exists, else
 * serve index.html — which is `webui.Mount`/`serveIndex` in the cloud binary, and
 * under that rule there IS no RSC payload to fetch, so Next's own router falls back
 * to a document load on every navigation. Nothing in the dev loop could show it.
 *
 * The rule below is that rule, and nothing else:
 *
 *   pnpm build:embed && node scripts/serve-export.mjs 4123
 *   BASE_URL=http://localhost:4123 pnpm exec playwright test e2e/navigation.spec.ts
 */
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { join, normalize, extname } from 'node:path'

const ROOT = join(import.meta.dirname, '..', 'out')
const PORT = Number(process.argv[2] ?? 4123)

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
}

/** The first of these that exists is the file for this address. */
function candidates(pathname) {
  // `..` cannot climb out: the path is normalized and re-rooted before it is joined.
  const clean = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '').replace(/^\/+/, '')
  return [clean, `${clean}.html`, join(clean, 'index.html')].filter(Boolean).map((p) => join(ROOT, p))
}

async function fileFor(pathname) {
  for (const path of candidates(pathname)) {
    if (!path.startsWith(ROOT)) continue
    const found = await stat(path).then((s) => s.isFile()).catch(() => false)
    if (found) return path
  }
  return null
}

createServer(async (req, res) => {
  const { pathname } = new URL(req.url ?? '/', 'http://localhost')
  // THE RULE: the file, or the shell. An address with no file of its own — every
  // product address — is answered with index.html and resolved in the browser, and
  // that is precisely why an RSC request for it comes back as HTML.
  const path = (await fileFor(pathname)) ?? join(ROOT, 'index.html')
  const body = await readFile(path).catch(() => null)
  if (!body) {
    res.writeHead(404, { 'content-type': 'text/plain' })
    return res.end('no export at out/ — run `pnpm build:embed` first')
  }
  res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream' })
  res.end(body)
}).listen(PORT, () => console.log(`serving ${ROOT} on http://localhost:${PORT} (file, else index.html)`))
