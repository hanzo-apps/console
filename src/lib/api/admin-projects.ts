/**
 * Admin PROJECTS client — the cross-org "what is deployed" board for staff.
 *
 * There is NO `/v1/admin/projects` endpoint: this is a lens over the EXISTING global
 * platform apps inventory (`PlatformApi.apps()` → `/v1/platform/apps`, the same ~100-app,
 * all-cluster, all-org board the Status/Kubernetes modules already read). Each app
 * row already carries its `org`, `cluster`, `releaseUrl`, health, and drift, so the
 * staff Projects view is a pure projection + group-by-org — no new backend surface.
 *
 * OPTIONAL-SAFE + honest states: an unreachable inventory throws (the module renders
 * an error/empty state); nothing is fabricated.
 */
import { PlatformApi, type PlatformApp } from './platform'

/** One deployed project/app row for the staff Projects board. */
export type ProjectRow = {
  org: string
  app: string
  /** Health as the inventory reports it (green/yellow/red/…) — the app's status. */
  status: string
  cluster: string
  /** Live URL (the app's release/route), or '' when none is published. */
  url: string
  namespace: string
  env: string
  /** Drift severity ('' when the app is in sync). */
  drift: string
  updatedAt: string
}

/** Project two-shape platform app into the staff Projects row (org already present). */
export function toProjectRow(a: PlatformApp): ProjectRow {
  return {
    org: a.org || '',
    app: a.app || a.id || '',
    status: a.health || '',
    cluster: a.cluster || '',
    url: a.releaseUrl || '',
    namespace: a.namespace || '',
    env: a.env || '',
    drift: a.drift?.severity || '',
    updatedAt: a.updatedAt || a.lastObserved || '',
  }
}

/** Group project rows by org, orgs sorted A→Z (for the drill-by-org view). */
export function groupByOrg(rows: ProjectRow[]): { org: string; rows: ProjectRow[] }[] {
  const by = new Map<string, ProjectRow[]>()
  for (const r of rows) {
    const key = r.org || '—'
    const list = by.get(key)
    if (list) list.push(r)
    else by.set(key, [r])
  }
  return Array.from(by.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([org, list]) => ({ org, rows: list }))
}

export const AdminProjectsApi = {
  /** Every deployed app across all orgs/clusters, as staff Project rows. */
  list: async (): Promise<ProjectRow[]> => (await PlatformApi.apps()).map(toProjectRow),
}
