/**
 * Projects API — projects live UNDER the brand org (Hanzo IAM owns them) and
 * scope every resource (o11y, API keys, datasets, deploys) below them. Served by
 * **IAM** (not the cloud binary) at the one `projects` entity: `GET` for the
 * org-scoped list, `POST` to create, `POST projects/delete` to remove. The IAM
 * `Project` is keyed `(owner, name)` with an indexed `organization`; we set
 * owner = organization = the brand org so the record is owned and listed under it.
 *
 * ROUTING: these are `/v1/iam/*` endpoints reached over the ONE cloud IAM edge
 * (iam_edge.go). The one-binary console (console.hanzo.ai served by cloud) calls
 * it directly with the session cookie; a split console forwards `/v1/iam/*` through
 * its `/v1` bearer proxy. The edge pins `organization` to the caller's validated,
 * server-minted org — one tenant can never list another's projects, since IAM's own
 * authz is permissive on this route. This replaces the old `/org/iam` BFF, which
 * the static one-binary console cannot run (it has no server routes).
 *
 * Environments (mainnet/testnet/devnet + custom) are a console-side scoping
 * dimension — IAM's Project has no environments column — so they live in
 * `lib/scope.ts`, not in this payload.
 */
import { iamList, iamMutate } from './client'
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
   * List the org's projects via `/v1/iam` → the cloud IAM edge, which pins
   * `organization` to the caller's own validated scope (the org-isolation gate,
   * since IAM's own authz is permissive on this route). Returns exactly the
   * projects under the caller's org.
   *
   * `owner` is the scope IAM reads — it resolves the listing against the caller's
   * own principal and refuses any other org, so this is a request to be told which
   * projects are ours, not a filter we are trusted to have applied.
   */
  list: (): Promise<Project[]> => iamList<Project>('projects', { owner: org() }).then((r) => r.rows),

  /**
   * Create a project under the org. `name` is the org-unique id (slug-safe — it
   * doubles as the deploy site slug and the shared cross-surface `?project=` key);
   * `displayName` is the friendly label (defaults to `name` for callers that don't
   * distinguish them).
   */
  create: (p: { name: string; displayName?: string; description?: string }): Promise<void> =>
    iamMutate('projects', {
      owner: org(),
      name: p.name,
      displayName: p.displayName ?? p.name,
      organization: org(),
      description: p.description ?? '',
    }),

  /** Delete a project. The (owner, name) it removes rides in the body. */
  remove: (name: string): Promise<void> =>
    iamMutate('projects/delete', { owner: org(), name }),
}
