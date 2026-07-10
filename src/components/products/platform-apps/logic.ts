/**
 * Pure view-logic for the per-org PaaS module (unit-tested; no React, no I/O).
 * Every helper is a total function over the `/v1/platform` view-models so the UI
 * stays a thin render of honest, backend-derived state.
 */
import type { PlatformApp, PlatformEnvVar } from '~/lib/api/platform-apps'

/** Mask token shown in place of a secret value (the backend already blanks it). */
export const SECRET_MASK = '••••••••'

/**
 * The single status string a StatusTag renders for an app. Prefer the operator's
 * live health verdict (green/yellow/red) when present, else the phase, else the
 * stored lifecycle status — never a fabricated "running".
 */
export function appDisplayStatus(app: Pick<PlatformApp, 'status' | 'phase' | 'health'>): string {
  if (app.health) return app.health // green | yellow | red (StatusTag maps to tone)
  if (app.phase) return app.phase.toLowerCase()
  return app.status || 'unknown'
}

/** The app's current container image ref (`repository:tag`), or '' when it has no
 *  image yet — the value shown in the Image fact and the key the SBOM panel looks up. */
export function appImageRef(app: Pick<PlatformApp, 'image'>): string {
  const repo = app.image?.repository
  return repo ? `${repo}:${app.image?.tag || 'latest'}` : ''
}

/** Human label for the KMS secret-sync state; '' when the app has no secrets. */
export function secretSyncLabel(app: Pick<PlatformApp, 'secretSync'>): string {
  switch (app.secretSync) {
    case 'ready':
      return 'Secrets ready'
    case 'syncing':
      return 'Secrets syncing'
    case 'pending':
      return 'Secrets pending'
    case 'failed':
      return 'Secrets failed'
    default:
      return ''
  }
}

/** How many secret env vars an app declares (drives the "N secret" hint). */
export function secretCount(env: PlatformEnvVar[] | undefined): number {
  return (env ?? []).filter((e) => e.secret).length
}

/**
 * Env rows for display: a secret's value is ALWAYS masked (defense in depth — the
 * backend blanks it, and we never render even an accidental leak). Sorted by key
 * for a stable table.
 */
export function maskedEnvRows(env: PlatformEnvVar[] | undefined): { key: string; value: string; secret: boolean }[] {
  return [...(env ?? [])]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((e) => ({ key: e.key, secret: e.secret, value: e.secret ? SECRET_MASK : e.value }))
}

/** An app is deployed (has a running/scalable Service CR) iff it left "draft". */
export function isDeployed(app: Pick<PlatformApp, 'status'>): boolean {
  return app.status !== 'draft' && app.status !== ''
}

/** Deploy is allowed unless a build/deploy is already in flight. */
export function canDeploy(app: Pick<PlatformApp, 'status'>): boolean {
  return app.status !== 'building' && app.status !== 'deploying'
}

/** Summary counts for the header band (all real, derived from the rows). */
export function summarize(apps: Pick<PlatformApp, 'status' | 'health'>[]): {
  total: number
  live: number
  building: number
  failed: number
} {
  let live = 0
  let building = 0
  let failed = 0
  for (const a of apps) {
    if (a.health === 'red' || a.status === 'error') failed++
    else if (a.status === 'building' || a.status === 'deploying') building++
    else if (a.status === 'live' || a.status === 'stopped') live++
  }
  return { total: apps.length, live, building, failed }
}

/** Pane label for the source-tagged deployment logs (cloud#75). */
export function logSourceLabel(source: string | undefined): string {
  switch (source) {
    case 'build':
      return 'Build logs'
    case 'app':
      return 'App logs'
    default:
      return 'No live logs yet'
  }
}

// ── env editor (add/edit/delete variables + write-only secrets) ────────────────

/** Env var key rule — mirrors cloud's `envKeyRE` (clients/platform), so the UI
 *  rejects a bad key before the round-trip instead of surfacing a 400. */
export const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/
export function envKeyValid(key: string): boolean {
  return ENV_KEY_RE.test(key)
}

/**
 * One editable env row. A secret is WRITE-ONLY: the backend never echoes its value
 * (masked to '' on read), so an existing secret carries `sealed:true` with an empty
 * `value` until the user chooses to `replace` it. `id` is a stable local key so an
 * input never loses focus as the user edits the `key` field.
 */
export type EnvDraft = {
  id: string
  key: string
  value: string
  secret: boolean
  /** Already sealed in KMS — its value is unknown here. */
  sealed: boolean
  /** User is typing a NEW value to replace the sealed one. */
  replace: boolean
}

/** Editable drafts from an app's env, secrets first-classed as write-only (sorted). */
export function toEnvDrafts(env: PlatformEnvVar[] | undefined): EnvDraft[] {
  return [...(env ?? [])]
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((e, i) => ({ id: `env-${i}`, key: e.key, value: e.secret ? '' : e.value, secret: e.secret, sealed: e.secret, replace: false }))
}

/**
 * The `setEnv` payload from drafts. A plain var carries its value; a NEW or REPLACED
 * secret carries its typed value; a KEPT sealed secret carries an empty value
 * (`secret:true`) — the backend PRESERVES the already-sealed value on empty (write-only
 * secret), so keeping is a no-op, never a re-seal or wipe. Empty-key rows are dropped;
 * keys are trimmed.
 */
export function draftsToEnv(drafts: EnvDraft[]): PlatformEnvVar[] {
  return drafts
    .filter((d) => d.key.trim() !== '')
    .map((d) => ({
      key: d.key.trim(),
      secret: d.secret,
      value: d.secret ? (d.sealed && !d.replace ? '' : d.value) : d.value,
    }))
}

/**
 * First honest validation error for the draft set, or null when OK: a missing/bad key
 * name, a duplicate key, or a NEW/replaced secret left without a value (a kept sealed
 * secret needs none — its value stays in KMS).
 */
export function validateEnvDrafts(drafts: EnvDraft[]): string | null {
  const seen = new Set<string>()
  for (const d of drafts) {
    const key = d.key.trim()
    if (key === '') return 'Every variable needs a name.'
    if (!envKeyValid(key)) return `"${key}" is not a valid name — use letters, digits, and _ (not starting with a digit).`
    if (seen.has(key)) return `Duplicate variable: ${key}.`
    seen.add(key)
    if (d.secret && (!d.sealed || d.replace) && d.value === '') return `Enter a value for the secret ${key}.`
  }
  return null
}
