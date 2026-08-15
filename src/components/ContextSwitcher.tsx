'use client'

/**
 * Context switcher — WHERE you are: the organization and the project, in ONE
 * control, at the TOP-LEFT where the tenant's mark already sits.
 *
 * The console used to answer "who and where am I" from three different corners:
 * the org at the top of the rail, the account (which also switched org) at its
 * foot, and the project chip in the top-right beside the network. Org and
 * project are one question — which tenant, and which slice of it — so they are
 * one control, and it sits with the org mark that already anchors the top-left.
 *
 * The ACCOUNT keeps the other question ("who am I") at the foot of the rail, and
 * wears the SAME `Menu` — same height, same mark, same type, same chevron — so the
 * two ends of the rail read as two halves of one identity.
 *
 * The org's NAME always shows. It used to be replaced by the org's logo whenever
 * IAM carried one, which left a tenant with a logo looking at a picture and no
 * name at all — the name survived only in the aria-label. The logo is the MARK now
 * (that is what `OrgMark` is for), and the name is the label, always.
 *
 * There is still exactly ONE org switch. `switchOrg` is passed by reference from
 * `~/lib/org-scope` (the seam that persists the scope and reloads so every
 * module refetches under the new `X-Org-Id`, which is where tenant scoping and
 * its billing attribution already live). This control does not mint a second
 * one, add a header of its own, or make a billing call — `org-state.test.ts`
 * pins that identity. Cross-tenant reach is the SAME admin-gated, server-paged
 * list the full-page picker uses; a regular user never fires it and sees only
 * their own org.
 */
import { useCallback, useMemo, useState } from 'react'
import { useRouter } from '~/lib/router'
import { Text, YStack } from '@hanzo/gui'
import { FolderGit2, Plus, SlidersHorizontal } from '@hanzogui/lucide-icons-2'

import { useScope } from '~/lib/scope-context'
import { useOrgIdentity } from '~/components/ui/BrandLogo'
import { useIsSuperAdmin } from '~/lib/auth/admin'
import { IamAdminApi, type Organization } from '~/lib/api'
import { ORG_PAGE_SIZE, orgQuery } from '~/lib/org-list'
import { currentOrg, leaveOrg, switchOrg } from '~/lib/org-scope'
import { contextLabel, orgLabel, scopedOrgRow } from '~/lib/account/org-state'
import { MenuRow } from '~/components/ui/MenuRow'
import { Menu, MenuLabel, MenuRule } from '~/components/ui/Menu'
import { OrgMark, SearchInput } from '@hanzo/ui/product'

export function ContextSwitcher() {
  const router = useRouter()
  const org = useOrgIdentity()
  const scoped = currentOrg()
  const isSuperAdmin = useIsSuperAdmin()
  const { scope, projects, loadingProjects, selectProject } = useScope()
  const [orgs, setOrgs] = useState<Organization[] | null>(null)
  const [query, setQuery] = useState('')

  // ONE naming rule — `orgLabel` — so the trigger and the row for the very same
  // org can never read differently ("Acme" above, "acme" below).
  const name = orgLabel(org.displayName ? org : { ...org, name: org.name || scoped })

  // The cross-tenant list is admin-gated at the proxy; a regular user would 403
  // it, so they are never asked to — their own org is the honest answer. An admin
  // searches the SERVER (the list is paged and far longer than one page), which is
  // the only way to reach a tenant nobody is a member of.
  const loadOrgs = useCallback(
    async (q: string) => {
      if (!isSuperAdmin) return setOrgs(scopedOrgRow({ ...org, name: org.name || scoped }))
      const res = await IamAdminApi.organizations(orgQuery(0, q, ORG_PAGE_SIZE))
      setOrgs(res.rows ?? [])
    },
    [isSuperAdmin, scoped, org],
  )

  const search = useCallback(
    (q: string) => {
      setQuery(q)
      void loadOrgs(q)
    },
    [loadOrgs],
  )

  const orgRows = useMemo(() => orgs ?? [], [orgs])

  return (
    <Menu
      mark={org}
      label={contextLabel(name, scope.project)}
      aria={`Organization and project — ${contextLabel(name, scope.project)}`}
      testId="switcher-context"
      onOpen={() => {
        if (orgs === null) void loadOrgs('')
      }}
    >
      {(close) => {
        const pick = (fn: () => void) => () => {
          close()
          fn()
        }
        return (
          <YStack gap="$0.5">
            <MenuLabel>Organization</MenuLabel>

            {/* Admins only: the cross-tenant list is server-paged and longer than
                one page, so reaching a tenant nobody is a member of means SEARCHING
                it, not scrolling. A regular user has one org and no field. */}
            {/* $2 to match MenuRow and MenuLabel. At $1 the field was inset half
                as far as every row under it, so the menu had two left edges and
                the search looked like it belonged to a different panel. */}
            {isSuperAdmin ? (
              <YStack px="$2" pb="$1">
                {/* A search landmark names the control for assistive tech — the shared
                    SearchInput has no accessible-name prop of its own. */}
                <div role="search" aria-label="Find an organization">
                  <SearchInput value={query} onChange={search} placeholder="Find an organization" name="org" />
                </div>
              </YStack>
            ) : null}

            <YStack role="radiogroup" aria-label="Organizations" gap="$0.5">
              {orgRows.map((o) => (
                <MenuRow
                  key={o.name}
                  label={orgLabel(o)}
                  icon={<OrgMark org={o} size={18} />}
                  active={scoped === o.name}
                  onPress={pick(() => {
                    if (o.name !== scoped) switchOrg(o.name)
                  })}
                />
              ))}
            </YStack>

            {orgRows.length === 0 ? (
              <Text px="$2" py="$1.5" fontSize="$2" color="$color10">
                {orgs === null ? 'Loading…' : 'No organization matches that.'}
              </Text>
            ) : null}

            <MenuRow
              label="Organization settings"
              icon={<SlidersHorizontal size={14} />}
              onPress={pick(() => router.push('/settings/branding'))}
            />

            <MenuRow label="All organizations" icon={<Plus size={14} />} onPress={pick(leaveOrg)} />

            <MenuRule />

            <MenuLabel>Project</MenuLabel>

            <YStack role="radiogroup" aria-label="Projects" gap="$0.5">
              {/* Org-level scope — no X-Project-Id sent. */}
              <MenuRow
                label="All projects"
                sub="Org-level"
                active={!scope.project}
                onPress={pick(() => selectProject(undefined))}
              />

              {projects.map((p) => (
                <MenuRow
                  key={p.name}
                  label={p.displayName || p.name}
                  active={scope.project === p.name}
                  onPress={pick(() => selectProject(p.name))}
                />
              ))}
            </YStack>

            {projects.length === 0 && !loadingProjects ? (
              <Text px="$2" py="$1.5" fontSize="$2" color="$color10">
                No projects yet. A project scopes API keys, usage and deploys to one piece of work — create one below.
              </Text>
            ) : null}

            <MenuRow
              label="New project"
              icon={<FolderGit2 size={14} />}
              onPress={pick(() => router.push('/projects'))}
            />
          </YStack>
        )
      }}
    </Menu>
  )
}
