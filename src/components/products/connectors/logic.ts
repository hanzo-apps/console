/**
 * Pure logic for the GitHub repositories view — no gui/React imports, so it is
 * unit-testable in isolation (the repo convention: bespoke UI is thin, decisions
 * are pure + tested).
 */
import type { GitHubRepo } from '~/lib/api'

/**
 * The human status label for a repo row (also the StatusTag tone key):
 *   Importing     — queued/importing and not yet present natively
 *   Not imported  — no native repo
 *   Conflict      — imported but a branch diverged (native preserved, never overwritten)
 *   Synced        — imported and in sync
 * `importing` (the optimistic client flag) only shows while the repo is not yet
 * imported — once native exists, the real Synced/Conflict status wins.
 */
export function repoStatusLabel(r: GitHubRepo, importing: boolean): string {
  if (importing && !r.imported) return 'Importing'
  if (!r.imported) return 'Not imported'
  if (r.syncStatus === 'conflict') return 'Conflict'
  return 'Synced'
}

/** Names of the repos not yet imported — the "Import all" selection. */
export function pendingRepoNames(repos: GitHubRepo[]): string[] {
  return repos.filter((r) => !r.imported).map((r) => r.name)
}
