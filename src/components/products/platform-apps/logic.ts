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
