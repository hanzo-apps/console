/**
 * OSS App Store catalog — the LIVE 1000+-app one-click open-source catalog served as a
 * flat JSON array at `<base>/meta.json` (default `https://templates.hanzo.ai`, the Dokploy
 * blueprint CDN). Each entry carries per-app blueprint assets under
 * `<base>/blueprints/<id>/` (`logo.<ext>`, `template.toml`, `docker-compose.yml`).
 *
 * The catalog is a PUBLIC CDN with open CORS (`access-control-allow-origin: *`), so the
 * App Store fetches it DIRECTLY from the browser — no BFF, no `/v1` proxy — which is why
 * it works in the go:embed console (where the Next reverse-proxies are pruned). The base
 * URL is INJECTED (callers pass `config.ossCatalogUrl`), so this module holds no config
 * import and its normalizers + URL builders are pure and unit-testable.
 *
 * DEPLOY is a SEPARATE concern (`store/DeployDialog`): it reuses the console's real PaaS
 * deploy path (`PaasApi`, `/v1/platform/*` on the cloud binary) — this module only reads
 * the catalog. The maker "Earn 20%" hook derives `owner/repo` from `links.github` (there
 * is no author field in the data) and routes to the console's own `/authors` program.
 */

/** One open-source app in the catalog (the meta.json entry, load-bearing fields only). */
export type OssApp = {
  /** Stable catalog id + blueprint path segment, e.g. `2fauth`, `n8n`, `postgres`. */
  id: string
  /** Display name, e.g. "2FAuth". */
  name: string
  /** One-line description. */
  description: string
  /** Version label — often the literal string `"latest"`, rendered raw. */
  version: string
  /** Bare logo filename (e.g. `logo.svg`), resolved against the blueprint path. */
  logo: string
  /** Category/provenance tags (e.g. `productivity`, `self-hosted`, `caprover`). */
  tags: string[]
  /** External links; only github/website/docs are surfaced (discord/docker ignored). */
  links: { github?: string; website?: string; docs?: string }
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const strTrim = (v: unknown): string | undefined => {
  const s = str(v).trim()
  return s ? s : undefined
}
const strList = (v: unknown): string[] =>
  Array.isArray(v)
    ? v.map((x) => (typeof x === 'string' ? x.trim() : '')).filter((x) => x !== '')
    : []
const asRecord = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}

/** Normalize one catalog record to an `OssApp` (drops a record with no id + name). */
export function normalizeOssApp(raw: unknown): OssApp | null {
  const r = asRecord(raw)
  const id = str(r.id).trim()
  const name = str(r.name).trim() || id
  if (!id || !name) return null
  const links = asRecord(r.links)
  return {
    id,
    name,
    description: str(r.description).trim(),
    version: str(r.version).trim() || 'latest',
    logo: str(r.logo).trim(),
    tags: strList(r.tags),
    links: {
      github: strTrim(links.github),
      website: strTrim(links.website),
      docs: strTrim(links.docs),
    },
  }
}

/** Normalize the catalog payload to the app list (bare array OR a `{data|apps|templates}` wrap). */
export function normalizeOssApps(payload: unknown): OssApp[] {
  let arr: unknown[] = []
  if (Array.isArray(payload)) arr = payload
  else if (payload && typeof payload === 'object') {
    for (const k of ['data', 'apps', 'templates', 'items', 'rows']) {
      const v = (payload as Record<string, unknown>)[k]
      if (Array.isArray(v)) {
        arr = v
        break
      }
    }
  }
  const out: OssApp[] = []
  const seen = new Set<string>()
  for (const raw of arr) {
    const app = normalizeOssApp(raw)
    if (app && !seen.has(app.id)) {
      seen.add(app.id)
      out.push(app)
    }
  }
  return out
}

/** The per-app blueprint asset base: `<base>/blueprints/<id>`. */
export function blueprintBase(base: string, id: string): string {
  return `${base.replace(/\/+$/, '')}/blueprints/${encodeURIComponent(id)}`
}

/**
 * The app's logo URL (`<base>/blueprints/<id>/<logo>`), or null when the entry carries
 * no logo filename — the card then renders its monogram fallback (never a broken image).
 */
export function logoUrl(base: string, app: OssApp): string | null {
  if (!app.logo) return null
  return `${blueprintBase(base, app.id)}/${app.logo}`
}

/**
 * Derive `owner/repo` from a GitHub URL (the maker identity the "Earn 20%" hook uses —
 * there is no author field in the catalog). Returns null for a non-GitHub / malformed URL.
 */
export function ownerRepo(githubUrl?: string): string | null {
  if (!githubUrl) return null
  const m = githubUrl.match(/github\.com\/([^/\s]+)\/([^/\s#?]+)/i)
  if (!m) return null
  const owner = m[1]
  const repo = m[2].replace(/\.git$/i, '')
  if (!owner || !repo) return null
  return `${owner}/${repo}`
}

/**
 * The in-console Authors deep link the maker hook opens: `/authors` (the OSS Author
 * program), carrying the derived `owner/repo` as a forward-compatible `?claim=` hint.
 * Injection-safe (the repo is URL-encoded).
 */
export function claimPath(app: OssApp): string {
  const repo = ownerRepo(app.links.github)
  return repo ? `/authors?claim=${encodeURIComponent(repo)}` : '/authors'
}

// ── Live fetch (the one impure surface) ──────────────────────────────────────
//
// Cached per base URL so the App Store page and the Platform home's featured strip
// share ONE ~500 KB fetch. An in-flight fetch is de-duped (concurrent callers await the
// same promise); a failure is not cached (the next caller retries).
const cache = new Map<string, OssApp[]>()
const inflight = new Map<string, Promise<OssApp[]>>()

/**
 * Fetch + normalize the OSS catalog from `<base>/meta.json`. Cross-origin, unauthenticated
 * (public CDN); throws on a non-2xx or a non-array/parse failure so the caller shows an
 * honest error state. Cached on success; `force` bypasses the cache for a manual refresh.
 */
export async function fetchOssApps(base: string, force = false): Promise<OssApp[]> {
  const key = base.replace(/\/+$/, '')
  if (!force) {
    const hit = cache.get(key)
    if (hit) return hit
    const pending = inflight.get(key)
    if (pending) return pending
  }
  const run = (async () => {
    const res = await fetch(`${key}/meta.json`, {
      headers: { Accept: 'application/json' },
      // Public catalog — no credentials, so a signed-in session cookie never leaks cross-origin.
      credentials: 'omit',
    })
    if (!res.ok) throw new Error(`Catalog unavailable (HTTP ${res.status})`)
    const apps = normalizeOssApps(await res.json())
    cache.set(key, apps)
    return apps
  })()
  inflight.set(key, run)
  try {
    return await run
  } finally {
    inflight.delete(key)
  }
}
