/**
 * The `@hanzo/ui/gitops` mount seam.
 *
 * The rich ArgoCD-grade UI (resource TOPOLOGY graph, desired-vs-live DIFF viewer,
 * streaming LOG viewer, per-resource drill-in) is being ported into a reusable
 * `@hanzo/ui/gitops` export (built on our primitives + `@hanzo/canvas`) by a
 * parallel agent. The console's job is THIN: own the `/gitops` route + the
 * `/v1/gitops` data wiring + auth, and MOUNT those components — not rebuild them.
 *
 * `@hanzo/ui` is not yet a console dependency and `@hanzo/ui/gitops` does not yet
 * exist, so this file declares the component prop CONTRACT the console codes
 * against (the shapes flow straight from `~/lib/api/gitops`). When the package
 * lands, wiring is a one-line import swap:
 *
 *   // add "@hanzo/ui" to package.json + transpilePackages, then:
 *   import { ApplicationTree, ResourceDiff, LogViewer } from '@hanzo/ui/gitops'
 *
 * and the interim panels in `GitOpsModule.tsx` (marked `MOUNT SEAM`) are replaced
 * by these components, fed the SAME props below. The pure adapters in `logic.ts`
 * (`treeToGraph`, the health/sync folds) already map the raw `/v1/gitops` DTOs
 * into the `@hanzo/canvas` node/edge model these components render.
 */
import type { Application, AppTree, LogLine, ResourceDetail } from '~/lib/api/gitops'

/** The npm specifier to add to `package.json` + `next.config.mjs` transpilePackages. */
export const GITOPS_UI_PACKAGE = '@hanzo/ui/gitops'

/**
 * `<ApplicationList>` — the applications board (name · version · health · sync ·
 * actions). The console's interim `ApplicationsBoard` conforms to this shape.
 */
export interface ApplicationListProps {
  applications: Application[]
  loading?: boolean
  onOpen: (name: string) => void
  onRollback: (app: Application) => void
  onSync: (app: Application) => void
}

/**
 * `<ApplicationTree>` — the pannable/zoomable owned-resource topology (Service CR
 * → Deployment → ReplicaSet → Pods …), color-coded by health, a node open →
 * resource drill-in. Fed the raw tree; it maps via `treeToGraph` internally (or
 * the console passes the pre-folded `@hanzo/canvas` model — the component accepts
 * either). `loadResource` lazily fetches a node's manifest/diff/events on open.
 */
export interface ApplicationTreeProps {
  tree: AppTree
  onOpenResource?: (ref: string) => void
  loadResource?: (ref: string) => Promise<ResourceDetail>
  theme?: 'light' | 'dark'
  reducedMotion?: boolean
}

/** `<ResourceDiff>` — the desired-vs-live manifest diff + live YAML + events. */
export interface ResourceDiffProps {
  detail: ResourceDetail
}

/** `<LogViewer>` — the streaming pod/container log surface. */
export interface LogViewerProps {
  lines: LogLine[]
  loading?: boolean
  onRefresh?: () => void
}
