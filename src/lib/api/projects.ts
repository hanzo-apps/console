/**
 * Projects API — projects live UNDER the brand org (Hanzo IAM owns them) and
 * scope every resource (o11y, API keys, datasets, deploys) below them. Served by
 * IAM on the unified backend at `/v1/iam/*`: `get-organization-projects`
 * (org-scoped list), `add-project`, `delete-project` — the same `/v1/iam/`
 * surface as `get-organizations`. The IAM `Project` is keyed `(owner, name)`
 * with an indexed `organization`; we set owner = organization = the brand org so
 * the record is owned and listed under it.
 *
 * Environments (mainnet/testnet/devnet + custom) are a console-side scoping
 * dimension — IAM's Project has no environments column — so they live in
 * `lib/scope.ts`, not in this payload.
 */
import { get, post, idOf, type ApiResponse } from './client'
import { currentOrg } from '~/lib/org-scope'
import { STOCK_ENVIRONMENTS } from '~/lib/scope'

/** A project under the org (mirrors IAM `object.Project`). */
export type Project = {
  /** Record owner — set to the brand org; with `name` forms the `owner/name` id. */
  owner?: string
  name: string
  displayName?: string
  description?: string | null
  /** Indexed org the project belongs to (= owner for our single-brand console). */
  organization?: string
  /** Custom environments beyond the intrinsic mainnet/testnet/devnet (console-side). */
  environments?: string[]
  createdTime?: string
}

/**
 * The full environment list for a project: the three intrinsic ones first, then
 * any custom environments. Stable order so the switcher reads predictably.
 */
export const projectEnvironments = (p?: Project): string[] => {
  const custom = (p?.environments ?? []).filter(
    (e) => !STOCK_ENVIRONMENTS.includes(e as (typeof STOCK_ENVIRONMENTS)[number]),
  )
  return [...STOCK_ENVIRONMENTS, ...custom]
}

const org = () => currentOrg()

export const ProjectApi = {
  /**
   * List the org's projects. IAM's `get-organization-projects?organization=<org>`
   * returns exactly the projects under the org (the purpose-built lister), so the
   * console doesn't have to know the record owner.
   */
  list: (): Promise<Project[]> =>
    get<Project[]>('iam/get-organization-projects', { organization: org() }),

  /** Create a project under the org (`POST /v1/iam/add-project`). */
  create: (p: { name: string; description?: string }): Promise<ApiResponse<string>> =>
    post('iam/add-project', {
      owner: org(),
      name: p.name,
      displayName: p.name,
      organization: org(),
      description: p.description ?? '',
    }),

  /** Delete a project (`POST /v1/iam/delete-project`, keyed by `owner/name`). */
  remove: (name: string): Promise<ApiResponse<string>> =>
    post('iam/delete-project', { owner: org(), name, organization: org() }, { id: idOf(org(), name) }),
}
