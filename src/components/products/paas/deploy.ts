/**
 * Deploy orchestration — the ONE way the console launches a new app on the live
 * Hanzo PaaS (`/v1/platform/*` via the `/cloud` bearer proxy). Both the "Deploy
 * something new" hub and the Applications board's New-app form drive this, so the
 * three real steps (resolve/create project → create app → kick off the deploy)
 * live in exactly one place.
 *
 * Pure inputs → real I/O against `PaasApi`; the pure per-target mapping is in
 * `logic.ts` (unit-tested), so this file is the thin I/O shell. It returns the
 * `{ project, app }` slugs the caller hands to `RailwayDeploy` to WATCH the deploy
 * go Queued → Building → Deploying → Live.
 */
import { PaasApi } from '~/lib/api/paas'
import { createAppInputFor, deployInputFor, type DeployTarget } from './logic'

/** The composer's resolved values for one launch. */
export interface LaunchInput {
  /** An existing project's slug/id to deploy into (mutually exclusive with `newProjectName`). */
  projectSlug?: string
  /** Create a new project with this name first (when no existing project chosen). */
  newProjectName?: string
  /** The app name (required). */
  appName: string
  /** Which target — service | static | container. */
  target: DeployTarget
  /** The git repo URL (service/static) OR the image ref (container). */
  ref: string
  /** Git branch (service/static only). */
  branch?: string
}

/** The slugs to watch the live deployment on. */
export interface Launched {
  project: string
  app: string
}

/** Report which step is running (for a live "Preparing…/Creating…/Deploying…" label). */
export type LaunchStep = 'project' | 'app' | 'deploy'

/**
 * Launch a deploy: (1) resolve the project (create it when `newProjectName` is
 * given), (2) create the app for the chosen target, (3) kick off the deploy.
 * Returns the project + app slugs so the caller can watch the pipeline. Throws the
 * underlying `ApiError` on any step (the caller classifies it honestly).
 */
export async function launchDeploy(
  input: LaunchInput,
  onStep?: (step: LaunchStep) => void,
): Promise<Launched> {
  onStep?.('project')
  let projectSlug: string
  const newName = input.newProjectName?.trim()
  if (newName) {
    const p = await PaasApi.createProject({ name: newName })
    projectSlug = p.slug || p.id
  } else {
    projectSlug = (input.projectSlug || '').trim()
    if (!projectSlug) throw new Error('No project selected')
  }

  onStep?.('app')
  const app = await PaasApi.createApp(
    projectSlug,
    createAppInputFor(input.target, { name: input.appName, ref: input.ref, branch: input.branch }),
  )
  const appSlug = app.slug || app.id

  onStep?.('deploy')
  await PaasApi.deploy(projectSlug, appSlug, deployInputFor(input.target, input.ref))

  return { project: projectSlug, app: appSlug }
}
