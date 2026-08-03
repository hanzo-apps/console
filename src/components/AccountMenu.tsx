'use client'

/**
 * The account control — WHO you are: identity, your team, your personal
 * settings, what you have left to spend, and the way out. ONE control, at the
 * foot of the rail.
 *
 * It deliberately does NOT switch tenant. Org and project are one question —
 * WHERE you are — and they are answered together by `ContextSwitcher` at the
 * top-left, beside the tenant's own mark. Handing this menu an `orgState` too
 * would put the org in two corners again, which is the exact confusion the
 * condensed switcher removes. The cross-tenant reach, the admin-gated org list
 * and the single `org-scope.switchOrg` money seam all moved there intact; there
 * is still exactly one org switch in the app.
 *
 * It is `@hanzo/iam`'s `UserMenu`, the same component hanzo.chat mounts, so the
 * identity and the behaviour (click-away, Escape, close-before-navigate, never a
 * raw uuid) are shared rather than rebuilt. This file is the ADAPTER —
 * everything the console knows that the SDK does not:
 *
 *  - THEME. The console themes through `@hanzogui/next-theme` (which drives the
 *    Gui tree). That is adapted into the menu's shape rather than mounting IAM's
 *    own theme hook beside it — one theme system, not two.
 *
 *  - BRAND. The strip at the foot wears THIS host's brand. Passing nothing would
 *    paint a Hanzo mark on a Lux or Zoo console.
 */
import { useMemo } from 'react'
import { UserMenu, type UserTheme } from '@hanzo/iam/react'
import { useThemeSetting } from '@hanzogui/next-theme'

import { config } from '~/config'
import { useSession } from '~/lib/auth/session'
import { useCloudBalance, spendableCents } from '~/lib/billing/live-balance'

export function AccountMenu() {
  const { account, signOut } = useSession()
  const { balance } = useCloudBalance()
  const { current, resolvedTheme, set } = useThemeSetting()

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
      theme={theme}
      settingsUrl="/profile"
      usageUrl="/billing"
      usageLabel="Billing & usage"
      // Only shown when the backend actually reported a balance — never a fabricated $0.
      balance={cents === null ? undefined : { amountUsd: cents / 100, topUpUrl: config.payUrl }}
      items={[
        // Your people, beside your own settings — the other half of "who am I".
        // Choosing a DIFFERENT tenant is a different question and lives in the
        // top-left context switcher, so this menu never re-scopes the console.
        { label: 'Team', href: '/team' },
        { label: 'Documentation', href: config.docsUrl, external: true, separatorBefore: true },
      ]}
      brand={{ name: config.brandName }}
    />
  )
}
