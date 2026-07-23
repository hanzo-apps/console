/**
 * Code hub — pure, unit-tested logic for the unified Code surface (Dev). No React /
 * Gui / registry imports (types only, erased by the compiler), so it is node-testable
 * without the GUI tree — the repo convention for a product's `logic.ts`.
 *
 * The hub is ONE product over TWO real backends: the native git host (`/v1/git`, repo
 * list + browse) and the code-intelligence engine (`/v1/code`, cross-repo hybrid search
 * + cited ask). This module owns the pure decisions the hub's faces share: the repo-list
 * filter + org grouping, the in-hub deep-link builders (repo → browser, span/citation →
 * file), and the assistant-seed prompt composition (repo/file context for "Ask AI").
 */
import type { Repo } from '~/lib/api/git'

/** The hub's URL root. Every in-hub navigation is built from this ONE base (DRY). */
export const CODE_BASE = '/code'

/** The three hub faces (level-2 tabs). `repos` is the default landing (the front door). */
export type HubTab = 'repos' | 'search' | 'ask'
export const HUB_TABS: HubTab[] = ['repos', 'search', 'ask']
export const HUB_TAB_LABEL: Record<HubTab, string> = { repos: 'Repositories', search: 'Search', ask: 'Ask' }

/** Fold a loose tab string to a valid hub tab (unknown / '' → the default `repos`). PURE. */
export function canonicalTab(raw?: string): HubTab {
  const t = (raw ?? '').toLowerCase().trim()
  return (HUB_TABS as string[]).includes(t) ? (t as HubTab) : 'repos'
}

// ── Repo list: filter + group (the Repos face) ───────────────────────────────

/**
 * Filter repos by a free-text query — a LITERAL, case-insensitive substring over the
 * repo's name/description/org/project. NEVER a compiled RegExp of user input (ReDoS-safe
 * by construction — the same guard the ⌘K / marketplace / combobox filters use). Empty
 * query → the full list. PURE.
 */
export function filterRepos(repos: Repo[], query: string): Repo[] {
  const q = query.trim().toLowerCase()
  if (!q) return repos
  return repos.filter((r) =>
    `${r.name} ${r.description ?? ''} ${r.org} ${r.project ?? ''}`.toLowerCase().includes(q),
  )
}

/** One org group in the repos list: the org label + its repos (backend order preserved). */
export type RepoGroup = { org: string; repos: Repo[] }

/**
 * Group repos by their owning org, groups sorted by org name; within a group the
 * backend's order (most-recently-updated first) is preserved. `/v1/git/repos` is
 * org-scoped server-side so this is usually ONE group (the caller's current org) — the
 * grouping only renders a header when there is more than one, so it never adds noise for
 * the common case yet groups correctly if a federated/global-admin scope ever returns
 * several orgs. An empty org string buckets under '—' (honest, never dropped). PURE.
 */
export function groupReposByOrg(repos: Repo[]): RepoGroup[] {
  const byOrg = new Map<string, Repo[]>()
  for (const r of repos) {
    const key = r.org || '—'
    const bucket = byOrg.get(key)
    if (bucket) bucket.push(r)
    else byOrg.set(key, [r])
  }
  return [...byOrg.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([org, rs]) => ({ org, repos: rs }))
}

// ── In-hub deep links (pure, injection-safe) ─────────────────────────────────

/** The repo-browser URL for a repo name (`/code/repos/<name>`). */
export function repoHref(name: string): string {
  return `${CODE_BASE}/repos/${encodeURIComponent(name)}`
}

/**
 * The repo-browser URL for a specific file at a ref (`/code/repos/<repo>?path&view=blob`).
 * A cross-repo search hit or an answer citation (repo + file [+ ref]) deep-links straight
 * into the file view — the seam that unifies search/ask with the browser. Query params are
 * URL-encoded (`URLSearchParams`), so nothing in a path/ref can inject another param.
 */
export function repoFileHref(repo: string, file: string, ref?: string): string {
  const sp = new URLSearchParams()
  if (ref) sp.set('ref', ref)
  if (file) sp.set('path', file)
  sp.set('view', 'blob')
  return `${CODE_BASE}/repos/${encodeURIComponent(repo)}?${sp.toString()}`
}

// ── Assistant-seed prompts ("Ask AI about this code") ────────────────────────

/** A bounded slice of file text for a seed — caps by BOTH lines and chars so a huge file
 *  never floods the composer. Returns the shown text + whether it was truncated. PURE. */
export function boundedCode(
  content: string,
  maxLines = 200,
  maxChars = 8000,
): { text: string; truncated: boolean; shownLines: number } {
  const lines = content.split('\n')
  let text = content
  let truncated = false
  if (lines.length > maxLines) {
    text = lines.slice(0, maxLines).join('\n')
    truncated = true
  }
  if (text.length > maxChars) {
    text = text.slice(0, maxChars)
    truncated = true
  }
  return { text, truncated, shownLines: truncated ? text.split('\n').length : lines.length }
}

/**
 * The seed prompt for "Ask AI about this repository" — names the repo (+ its description)
 * and asks for an orientation. The built-in assistant (grounded over docs + the model)
 * answers; the user reviews the pre-filled question before sending. PURE.
 */
export function askRepoPrompt(repo: { name: string; description?: string }): string {
  const desc = repo.description?.trim() ? `: ${repo.description.trim()}` : ''
  return `Give me an overview of the \`${repo.name}\` repository${desc}. What is it, how is it structured, and where should I start reading?`
}

/**
 * The seed prompt for "Ask AI about this file" — the locator PLUS the actual (bounded)
 * file content in a fenced block, so the assistant reasons over the real code, not just
 * the path. The user reviews the pre-filled prompt before sending (no surprise send). PURE.
 */
export function askFilePrompt(repo: string, path: string, lang: string, content: string): string {
  const b = boundedCode(content)
  const fence = lang && lang !== '—' ? lang.toLowerCase() : ''
  const note = b.truncated ? `\n\n(Truncated — first ${b.shownLines} lines shown.)` : ''
  return `Explain this file from the \`${repo}\` repository — what it does and how it fits the codebase.\n\nPath: ${path}\n\n\`\`\`${fence}\n${b.text}\n\`\`\`${note}`
}
