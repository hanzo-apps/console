'use client'

/**
 * The account control — who you are, which organization you are acting in, what
 * you have left to spend, and the way out. ONE control, at the foot of the rail.
 *
 * It is `@hanzo/iam`'s `UserMenu`, the same component hanzo.chat mounts, so the
 * identity, the switcher and the behaviour (click-away, Escape, close-before-
 * navigate, never a raw uuid) are shared rather than rebuilt. This file is the
 * ADAPTER — everything the console knows that the SDK does not:
 *
 *  - ORG REACH. `useOrganizations()` reads the caller's memberships off the token
 *    and cannot express what an admin console does: enter ANY tenant. So the
 *    switcher is handed `findOrgs`, backed by the console's existing lazy,
 *    server-paged cross-tenant list (`IamAdminApi.organizations` through the
 *    gated `/admin/iam` proxy) — the same source the full-page org picker uses.
 *    A regular user never fires it: they see their own org, synthesized from the
 *    session, exactly as before. Nothing is fabricated, and nobody's reach widens.
 *
 *  - MONEY. Switching goes through `org-scope.switchOrg` — the console's existing
 *    switch, passed by reference, not reimplemented. It persists the scope and
 *    reloads so every module refetches under the new `X-Org-Id`. That one seam is
 *    where tenant scoping and its billing attribution already live; this file adds
 *    no second switch, no header of its own, and no billing call, so the rule about
 *    which ledger a masquerading admin's spend lands on is exactly where it was.
 *    `org-state.test.ts` pins the identity so a second switch cannot creep in.
 *
 *  - THEME. The console themes through `@hanzogui/next-theme` (which drives the
 *    Gui tree). That is adapted into the menu's shape rather than mounting IAM's
 *    own theme hook beside it — one theme system, not two.
 *
 *  - BRAND. The strip at the foot wears THIS host's brand. Passing nothing would
 *    paint a Hanzo mark on a Lux or Zoo console.
 */
import { useCallback, useMemo } from 'react'
import { UserMenu, type OrgState, type UserTheme } from '@hanzo/iam/react'
import { useThemeSetting } from '@hanzogui/next-theme'

import { config } from '~/config'
import { adminOrgState, scopedOrgRow } from '~/lib/account/org-state'
import { useSession } from '~/lib/auth/session'
import { useIsSuperAdmin } from '~/lib/auth/admin'
import { IamAdminApi, type Organization } from '~/lib/api'
import { ORG_PAGE_SIZE, orgQuery } from '~/lib/org-list'
import { currentOrg, leaveOrg, switchOrg } from '~/lib/org-scope'
import { useCloudBalance, spendableCents } from '~/lib/billing/live-balance'

export function AccountMenu() {
  const { account, signOut } = useSession()
  // The cross-tenant list is admin-gated at the proxy; a regular user would 403 it,
  // so they are never asked to. Their own org is the honest answer.
  const isSuperAdmin = useIsSuperAdmin()
  const { balance } = useCloudBalance()
  const { current, resolvedTheme, set } = useThemeSetting()

  const scoped = currentOrg()

  const findOrgs = useCallback(
    async (query: string): Promise<Organization[]> => {
      if (!isSuperAdmin) return scopedOrgRow(scoped)
      const res = await IamAdminApi.organizations(orgQuery(0, query, ORG_PAGE_SIZE))
      return res.rows ?? []
    },
    [isSuperAdmin, scoped],
  )

  // The console's own switch, by reference: persist the scope, reload, refetch
  // under the new X-Org-Id. Pinned in `org-state.test.ts`.
  const orgState: OrgState = useMemo(
    () => adminOrgState({ scoped, findOrgs, switchOrg }),
    [scoped, findOrgs],
  )

  // `system` is a real choice, and the console's provider already understands it.
  const theme: UserTheme = useMemo(
    () => ({
      mode: (current === 'light' || current === 'dark' ? current : 'system') as UserTheme['mode'],
      resolved: (resolvedTheme ?? current) === 'light' ? 'light' : 'dark',
      setMode: (mode) => set(mode),
    }),
    [current, resolvedTheme, set],
  )

  if (!account) return null

  const cents = spendableCents(balance)
  const name = account.displayName?.trim() || account.name

  return (
    <UserMenu
      align="up"
      identity={{
        name,
        email: account.email ?? null,
        initials: (name || '?').slice(0, 1).toUpperCase(),
        avatarUrl: account.avatar || null,
      }}
      isAuthenticated
      isLoading={false}
      onSignOut={() => void signOut()}
      orgState={orgState}
      theme={theme}
      settingsUrl="/profile"
      usageUrl="/billing"
      usageLabel="Billing & usage"
      // Only shown when the backend actually reported a balance — never a fabricated $0.
      balance={cents === null ? undefined : { amountUsd: cents / 100, topUpUrl: config.payUrl }}
      items={[
        {
          label: 'All organizations',
          // De-scope back to the full-page picker, where an org is entered — and
          // where a new one is created. The dropdown never grew its own form.
          onSelect: () => leaveOrg(),
        },
        { label: 'Documentation', href: config.docsUrl, external: true, separatorBefore: true },
      ]}
      brand={{ name: config.brandName }}
    />
  )
}
