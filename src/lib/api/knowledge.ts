/**
 * Knowledge API — the Hanzo KB knowledge graph + vault import over the unified cloud
 * `/v1/knowledge` surface (cloud `clients/knowledge`).
 *
 * `GET /v1/knowledge/graph` returns the org's knowledge as nodes (kb-page/kb-memory/
 * kb-source) + edges (parent tree, wikilinks, connector provenance), shaped for a
 * force-directed renderer. `POST /v1/knowledge/import?format=` ingests an Obsidian
 * vault zip / Notion export zip / Roam JSON / Evernote .enex as a kb-page tree with the
 * links intact. Both are org-scoped SERVER-SIDE: the read/write rides the same-origin
 * `/v1` user-bearer BFF (`cloudProxyV1Url`, the `knowledge` head allow-listed in
 * proxy-allow.ts), which mints a short-lived IAM token and lets cloud resolve the org
 * from the token `owner` — no credential in the browser. In the go:embed console the
 * same `/v1/knowledge/*` path reaches cloud directly under the session cookie.
 *
 * The graph payload is parsed by the pure `normalizeGraph`
 * (`components/products/knowledge/graph-logic`), so this client is a thin transport.
 */
import { cloudProxyV1Url, restGet, restPostRaw } from './client'

const enc = encodeURIComponent

/** ImportResult is the `/v1/knowledge/import` response: how many pages were filed. */
export interface ImportResult {
  format: string
  imported: number
  pages?: string[]
}

/** Content-Type per import format — informational; cloud reads the raw upload body
 *  regardless, so an octet-stream is always accepted. */
const CONTENT_TYPE: Record<string, string> = {
  obsidian: 'application/zip',
  notion: 'application/zip',
  roam: 'application/json',
  evernote: 'application/xml',
}

export const KnowledgeApi = {
  /** graph fetches the org's knowledge graph, optionally narrowed to a project. */
  graph: (project?: string): Promise<unknown> => {
    const q = project ? `?project=${enc(project)}` : ''
    return restGet<unknown>(cloudProxyV1Url('knowledge/graph') + q)
  },

  /** importVault uploads an export archive/file and returns the number of pages filed.
   *  `bytes` is the raw file (a zip / .enex / .json); `format` selects the normalizer. */
  importVault: (format: string, bytes: ArrayBuffer, project?: string): Promise<ImportResult | undefined> => {
    const q = `?format=${enc(format)}` + (project ? `&project=${enc(project)}` : '')
    return restPostRaw<ImportResult>(
      cloudProxyV1Url('knowledge/import') + q,
      bytes,
      CONTENT_TYPE[format] ?? 'application/octet-stream',
    )
  },
}
