/**
 * Projects API — projects live UNDER the brand org (Hanzo IAM owns them) and
 * scope every resource (o11y, API keys, datasets, deploys) below them. Served by
 * **IAM** (not the cloud binary): `get-organization-projects` (org-scoped list),
 * `add-project`, `delete-project`. The IAM `Project` is keyed `(owner, name)` with
 * an indexed `organization`; we set owner = organization = the brand org so the
 * record is owned and listed under it.
 *
 * ROUTING (the "projects not routed" fix): these are `/v1/iam/*` endpoints, which
 * the console host's `/v1` sends to the CLOUD binary → 404 (cloud doesn't serve
 * IAM). So Projects goes through the same-origin **`/org/iam`** BFF proxy, which
 * mints a user-bound Bearer server-side and forwards to `iam.hanzo.svc` — the org
 * is resolved from the token owner claim (per-tenant), the same pattern the member
 * roster already uses. The proxy pins the `organization` param to the caller's own
 * org, so one tenant can never list another's projects.
 *
 * Environments (mainnet/testnet/devnet + custom) are a console-side scoping
 * dimension — IAM's Project has no environments column — so they live in
 * `lib/scope.ts`, not in this payload.
 */
import { idOf } from './client'
import { makeIamClient } from './iam-envelope'
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

/** The IAM member proxy — mints the user Bearer server-side, scopes to the caller's org. */
const iam = makeIamClient('/org/iam')
const org = () => currentOrg()

export const ProjectApi = {
  /**
   * List the org's projects via the `/org/iam` Bearer proxy. IAM's
   * `get-organization-projects?organization=<org>` returns exactly the projects
   * under the org; the proxy pins `organization` to the caller's own scope.
   */
  list: (): Promise<Project[]> =>
    iam.iamList<Project>('get-organization-projects', { organization: org() }).then((r) => r.rows),

  /** Create a project under the org (`POST /org/iam/add-project`). */
  create: (p: { name: string; description?: string }): Promise<void> =>
    iam.iamMutate('add-project', {
      owner: org(),
      name: p.name,
      displayName: p.name,
      organization: org(),
      description: p.description ?? '',
    }),

  /** Delete a project (`POST /org/iam/delete-project`, keyed by `owner/name`). */
  remove: (name: string): Promise<void> =>
    iam.iamMutate('delete-project', { owner: org(), name, organization: org() }, { id: idOf(org(), name) }),
}
