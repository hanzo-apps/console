'use client'

/**
 * The account control — WHO you are: identity, your team, your personal
 * settings, the theme, and the way out. ONE control, at the foot of the rail.
 *
 * It is `UserMenu` from `@hanzo/ui/product`, given this console's identity,
 * rows and theme choice. It deliberately does NOT switch tenant: org and project
 * are one question — WHERE you are — answered together by `ContextSwitcher` at
 * the top-left, beside the tenant's own mark. Handing this menu an org too would
 * put the org in two corners again, which is the exact confusion the condensed
 * switcher removes. The cross-tenant reach, the admin-gated org list and the
 * single `org-scope` money seam all live there; there is still exactly one org
 * switch in the app.
 *
 * The two ends of the rail wear the same trigger and the same rows because they
 * are the same component underneath — not because two files were written to
 * match. Before this, three implementations claimed to be peers: the shared
 * package's own org and account controls (a size and a weight apart from each
 * other), and this console's local copy of both. It was `@hanzo/iam`'s
 * `UserMenu` before that: a second rendering system inside one rail, drawing raw
 * DOM through an injected global stylesheet into its own portal, with a 28px
 * circle and a one-letter initial against the org's rounded-square, two-letter
 * mark.
 *
 * The BALANCE is not here. `SidebarWallet` sits one row below this control and
 * shows the same number from the same hook, plus the trial/prepaid split and a
 * top-up button — so the copy in here was the same fact twice, the second time
 * behind a click.
 */
import { useRouter } from '~/lib/router'
import { BookOpen, Receipt, Users, UserRound } from '@hanzogui/lucide-icons-2'
import { useThemeSetting } from '@hanzogui/next-theme'
import { UserMenu } from '@hanzo/ui/product'

import { config } from '~/config'
import { useSession } from '~/lib/auth/session'
import { paper } from '~/components/ui/paper'
import { Z } from '~/lib/z'

/** `system` is a real choice, and the console's provider already understands it. */
const THEMES = [
  { mode: 'light', label: 'Light' },
  { mode: 'dark', label: 'Dark' },
  { mode: 'system', label: 'Sync with system' },
] as const

export function AccountMenu() {
  const router = useRouter()
  const { account, signOut } = useSession()
  const { current, set } = useThemeSetting()

  if (!account) return null

  // Never a fabricated "User" — a name nobody chose reads as a bug to the person
  // it names. The email's local part is a real name; the account name is a real name.
  const name = account.displayName?.trim() || account.name
  const mode = current === 'light' || current === 'dark' ? current : 'system'
  const go = (href: string) => () => router.push(href)

  return (
    <UserMenu
      name={name}
      email={account.email}
      avatar={account.avatar || undefined}
      aria={`Account — ${name}`}
      testId="nav-user"
      // At the FOOT of the rail, so the sheet opens upward, and from the rail's
      // own left edge rather than the trigger's right.
      direction="up"
      align="start"
      className={paper.className}
      style={{ zIndex: Z.popover }}
      groups={[
        [
          { id: 'profile', label: 'Profile', icon: <UserRound size={14} />, onPress: go('/profile') },
          { id: 'billing', label: 'Billing & usage', icon: <Receipt size={14} />, onPress: go('/billing') },
          // Your people, beside your own settings — the other half of "who am I".
          { id: 'team', label: 'Members', icon: <Users size={14} />, onPress: go('/team') },
          {
            id: 'docs',
            label: 'Documentation',
            icon: <BookOpen size={14} />,
            onPress: () => window.open(config.docsUrl, '_blank', 'noopener,noreferrer'),
          },
        ],
        // Three states, not a two-way flip: `system` is a real choice and the
        // console's provider already understands it. Every row carries whether
        // it is the chosen one, which is what makes the group a radiogroup.
        {
          label: 'Theme',
          items: THEMES.map((t) => ({
            id: `theme-${t.mode}`,
            label: t.label,
            active: mode === t.mode,
            onPress: () => set(t.mode),
          })),
        },
      ]}
      // The theme is answered by the group above; the default row would ask it a
      // second time, and offer only two of the three answers.
      theme={null}
      onSignOut={() => void signOut()}
    />
  )
}
