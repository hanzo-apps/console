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
 * The control ITSELF is `OrgSwitcher` from `@hanzo/ui/product` — the same one
 * hanzo.app renders. What is left here is the binding: which orgs this console
 * may see, how it names them, and the project rows it adds underneath. The
 * console used to draw the whole thing: its own trigger, its own sheet, its own
 * rows, its own search field. That is how its field came to sit half as far from
 * the left edge as the rows beneath it — a drift that cannot happen against a
 * component that owns both.
 *
 * The ACCOUNT keeps the other question ("who am I") at the foot of the rail, and
 * is `UserMenu` from the same package — one anatomy, so the two ends of the rail
 * are peers by construction rather than by two files agreeing to be.
 *
 * There is still exactly ONE org switch. `orgScope` is passed by reference from
 * `~/lib/org-scope` (the seam that persists the scope and reloads so every
 * module refetches under the new `X-Org-Id`, which is where tenant scoping and
 * its billing attribution already live). This control does not mint a second
 * one, add a header of its own, or make a billing call — `org-state.test.ts`
 * pins that identity. Cross-tenant reach is the SAME admin-gated, server-paged
 * list the full-page picker uses; a regular user never fires it and sees only
 * their own org.
 */
import { useCallback } from 'react'
import { useRouter } from '~/lib/router'
import { Text, YStack } from '@hanzo/gui'
import { FolderGit2, Plus, SlidersHorizontal } from '@hanzogui/lucide-icons-2'
import { MenuLabel, MenuRow, MenuRule, OrgSwitcher, type Org, type OrgScope } from '@hanzo/ui/product'

import { useScope } from '~/lib/scope-context'
import { useOrgIdentity } from '~/components/ui/BrandLogo'
import { useIsSuperAdmin } from '~/lib/auth/admin'
import { IamAdminApi } from '~/lib/api'
import { ORG_PAGE_SIZE, orgQuery } from '~/lib/org-list'
import {
  currentOrg,
  enterOrg,
  hasSelectedOrg,
  isScopedAway,
  leaveOrg,
  setCurrentOrg,
  switchOrg,
} from '~/lib/org-scope'
import { contextLabel, orgLabel, scopedOrgRow } from '~/lib/account/org-state'
import { paper } from '~/components/ui/paper'
import { Z } from '~/lib/z'

/** An IAM organization as the switcher's row shape — ONE naming rule, so the
 *  trigger and the row for the very same org can never read differently
 *  ("Acme" above, "acme" below). */
const row = (o: { name?: string; displayName?: string; logo?: string }): Org => ({
  name: o.name ?? '',
  displayName: orgLabel(o),
  logo: o.logo,
})

/**
 * This console's answer to the active-org contract the shared switcher takes —
 * a binding of the functions in `~/lib/org-scope`, not a second implementation.
 * Each keeps its own semantics, including the two only this console has: the
 * hand-off to the admin console when the org named is the reserved `admin` one,
 * and the reload of the address the person is already on rather than home.
 */
const orgScope: OrgScope = {
  currentOrg,
  setCurrentOrg,
  isScopedAway,
  hasSelectedOrg,
  enterOrg,
  leaveOrg,
  switchOrg,
}

export function ContextSwitcher() {
  const router = useRouter()
  const org = useOrgIdentity()
  const scoped = currentOrg()
  const isSuperAdmin = useIsSuperAdmin()
  const { scope, projects, loadingProjects, selectProject } = useScope()

  const named = { ...org, name: org.name || scoped }

  /**
   * The cross-tenant list is admin-gated at the proxy; a regular user would 403
   * it, so they are never asked to — their own org, resolved from the session,
   * is the honest answer and no request leaves the browser for it. An admin
   * searches the SERVER (the list is paged and far longer than one page), which
   * is the only way to reach a tenant nobody is a member of.
   *
   * The gate is on the FETCH, not on a filter applied afterwards: a
   * non-super-admin has no code path to the cross-tenant endpoint at all. It is
   * enforced server-side too — this is the matching client half.
   */
  const orgs = useCallback(
    async (page: number, query: string): Promise<Org[]> => {
      if (!isSuperAdmin) return page === 0 ? scopedOrgRow(named).map(row) : []
      const res = await IamAdminApi.organizations(orgQuery(page, query, ORG_PAGE_SIZE))
      return (res.rows ?? []).map(row)
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [isSuperAdmin, org.name, org.displayName, org.logo, scoped],
  )

  return (
    <OrgSwitcher
      scope={orgScope}
      orgs={orgs}
      pageSize={ORG_PAGE_SIZE}
      current={row(named)}
      // Admins only: the cross-tenant list is server-paged and longer than one
      // page, so reaching a tenant nobody is a member of means SEARCHING it, not
      // scrolling. A regular user has one org and no field.
      search={isSuperAdmin}
      heading="Organization"
      sub={scope.project}
      aria={`Organization and project — ${contextLabel(orgLabel(named), scope.project)}`}
      testId="switcher-context"
      className={paper.className}
      style={{ zIndex: Z.popover }}
      footer={(close) => {
        const pick = (fn: () => void) => () => {
          close()
          fn()
        }
        return (
          <>
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
          </>
        )
      }}
    />
  )
}
