'use client'

/**
 * The account control — WHO you are: identity, your team, your personal
 * settings, the theme, and the way out. ONE control, at the foot of the rail.
 *
 * It deliberately does NOT switch tenant. Org and project are one question —
 * WHERE you are — and they are answered together by `ContextSwitcher` at the
 * top-left, beside the tenant's own mark. Handing this menu an org too would put
 * the org in two corners again, which is the exact confusion the condensed
 * switcher removes. The cross-tenant reach, the admin-gated org list and the
 * single `org-scope.switchOrg` money seam all live there; there is still exactly
 * one org switch in the app.
 *
 * It is the SAME `Menu` the context switcher wears — same height, same mark, same
 * type, same chevron, same sheet — so the two ends of the rail are peers. It used
 * to be `@hanzo/iam`'s `UserMenu`: a second rendering system inside one rail,
 * drawing raw DOM through an injected global stylesheet into its own portal, with
 * a 28px circle and a one-letter initial against the org's rounded-square,
 * two-letter mark. Identity still comes from IAM (`useSession`, `signOut`) — what
 * changed is that the console draws its own rail with its own primitives, once.
 *
 * The BALANCE is not here. `SidebarWallet` sits one row below this control and
 * shows the same number from the same hook, plus the trial/prepaid split and a
 * top-up button — so the copy in here was the same fact twice, the second time
 * behind a click.
 */
import { useRouter } from '~/lib/router'
import { Text, YStack } from '@hanzo/gui'
import { BookOpen, LogOut, Receipt, Users, UserRound } from '@hanzogui/lucide-icons-2'
import { useThemeSetting } from '@hanzogui/next-theme'

import { config } from '~/config'
import { useSession } from '~/lib/auth/session'
import { MenuRow } from '~/components/ui/MenuRow'
import { Menu, MenuLabel, MenuRule } from '~/components/ui/Menu'

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

  return (
    <Menu
      mark={{ name, logo: account.avatar || undefined }}
      label={name}
      aria={`Account — ${name}`}
      testId="nav-user"
      up
    >
      {(close) => {
        const go = (href: string) => () => {
          close()
          router.push(href)
        }
        return (
          <YStack gap="$0.5">
            <YStack px="$2" py="$1.5">
              <Text fontSize="$2" color="$color12" numberOfLines={1}>
                {name}
              </Text>
              {account.email ? (
                <Text fontSize="$1" color="$color10" numberOfLines={1}>
                  {account.email}
                </Text>
              ) : null}
            </YStack>

            <MenuRule />

            <MenuRow label="Profile" icon={<UserRound size={14} />} onPress={go('/profile')} />
            <MenuRow label="Billing & usage" icon={<Receipt size={14} />} onPress={go('/billing')} />
            {/* Your people, beside your own settings — the other half of "who am I". */}
            <MenuRow label="Members" icon={<Users size={14} />} onPress={go('/team')} />
            <MenuRow
              label="Documentation"
              icon={<BookOpen size={14} />}
              onPress={() => {
                close()
                window.open(config.docsUrl, '_blank', 'noopener,noreferrer')
              }}
            />

            <MenuRule />

            <MenuLabel>Theme</MenuLabel>
            <YStack role="radiogroup" aria-label="Theme" gap="$0.5">
              {THEMES.map((t) => (
                <MenuRow
                  key={t.mode}
                  label={t.label}
                  active={mode === t.mode}
                  onPress={() => {
                    close()
                    set(t.mode)
                  }}
                />
              ))}
            </YStack>

            <MenuRule />

            <MenuRow
              label="Sign out"
              icon={<LogOut size={14} />}
              onPress={() => {
                close()
                void signOut()
              }}
            />
          </YStack>
        )
      }}
    </Menu>
  )
}
