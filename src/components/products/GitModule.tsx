'use client'

/**
 * Git — Hanzo Git, the org's hosted code repositories (Dev). A full gitea-parity READ
 * surface over the REAL per-org `/v1/git` subsystem (`GitApi`, the same-origin `/v1`
 * bearer BFF, org-scoped SERVER-SIDE — no org param ever leaves the browser):
 *
 *   /git            → the repos LIST (name · description · default branch · size ·
 *                     updated · clone), org-scoped.
 *   /git/:name      → the repo BROWSER — tree browser, blob view with syntax/line
 *                     numbers + image preview, README auto-render, branch/tag selector,
 *                     commit history, clone URLs, and a deploy-status slot; Issues /
 *                     Pull requests / Actions tabs are honest "coming" states until the
 *                     backend serves them. The ref/path/view/tab live in the URL query,
 *                     so every location is a shareable deep link.
 *
 * Honest by construction — every row/file/commit is REAL data from the backend; a field
 * a repo omits reads "—", and each browse endpoint that isn't live yet degrades to a
 * BackendStateCard/empty rather than a crash or a fabricated repo.
 *
 * git.hanzo.ai is the marketing landing + `git clone`/`git push` smart-HTTP host; THIS
 * console is the dashboard it links to.
 */
import { RepoList } from './git/RepoList'
import { RepoBrowser } from './git/RepoBrowser'

export function GitModule({ params }: { params: Record<string, string> }) {
  const name = params.name || ''
  return name ? <RepoBrowser name={name} /> : <RepoList />
}
