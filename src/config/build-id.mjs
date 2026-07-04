import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Deterministic Next build id — pin ONE id across every replica of a release.
 *
 * Root cause of the "refresh a sub-route → Application error / chunk 404" audit:
 * a rolling deploy runs two replicas from two different builds at once. Next's
 * page-data / RSC payloads live under `/_next/static/<BUILD_ID>/…`, and with the
 * DEFAULT config each `next build` mints a RANDOM build id — so two replicas built
 * from the SAME commit still disagree on BUILD_ID, and a request that lands on the
 * other replica 404s (the 404 falls through to the app-shell HTML → the browser
 * parses HTML as JS → "Unexpected token '<'"). Pinning the id to the COMMIT makes
 * every build of a given commit — on every replica — identical, so same-commit
 * replicas never diverge. (Cross-commit skew during a rollout is genuinely two
 * builds and is healed by the recovery boundaries + a single-shot rollout policy.)
 *
 * Precedence — most authoritative first:
 *   1. `SOURCE_COMMIT` (or `NEXT_BUILD_ID`) env — CI bakes the EXACT commit. The
 *      alpine runtime image has no `git` binary, so the SHA must arrive as a build
 *      arg → ENV; this is the production source of truth.
 *   2. the git HEAD sha, read straight from `.git` (no `git` binary needed) — gives
 *      a local `next build` the same per-commit id, for dev/prod parity.
 *   3. the package version — a stable last-resort fallback.
 *
 * Pure: all IO is injected, so the decision is unit-tested without a filesystem.
 *
 * @param {{ env: Record<string, string | undefined>, gitSha: string, version: string }} inputs
 * @returns {string}
 */
export function resolveBuildId({ env, gitSha, version }) {
  const explicit = (env.SOURCE_COMMIT ?? env.NEXT_BUILD_ID ?? '').trim()
  if (explicit) return explicit
  if (gitSha) return gitSha
  return `v${version}`
}

/**
 * Read the HEAD commit sha directly out of `.git` — no `git` binary required (the
 * build image has none). Resolves a symbolic HEAD via the loose ref file and falls
 * back to `packed-refs`. Returns '' when `.git` is absent (e.g. inside the image),
 * where `SOURCE_COMMIT` supplies the id instead.
 *
 * @param {string} root repo root that holds `.git`
 * @returns {string}
 */
export function readGitSha(root) {
  try {
    const head = readFileSync(join(root, '.git', 'HEAD'), 'utf8').trim()
    const ref = head.match(/^ref:\s*(.+)$/)
    if (!ref) return /^[0-9a-f]{7,40}$/i.test(head) ? head : ''
    const loose = join(root, '.git', ref[1])
    if (existsSync(loose)) return readFileSync(loose, 'utf8').trim()
    const packed = join(root, '.git', 'packed-refs')
    if (existsSync(packed)) {
      for (const line of readFileSync(packed, 'utf8').split('\n')) {
        if (!line || line.startsWith('#') || line.startsWith('^')) continue
        const [sha, name] = line.split(' ')
        if (name === ref[1]) return sha.trim()
      }
    }
    return ''
  } catch {
    return ''
  }
}
