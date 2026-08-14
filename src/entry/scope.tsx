'use client'

/**
 * Scope — the `org` stage view. EVERY login lands org-LESS; this view resolves which of
 * the org-selection surfaces to show, from values the entry passes it (no gate logic of
 * its own):
 *   • no org at all        → first-run org onboarding (create / join).
 *   • an org, not hydrated → a brief neutral loader (selection is a client-only read).
 *   • an org, not ENTERED  → the {@link OrgPicker} (the "Home" org list; even a one-org
 *     user clicks in — we never auto-enter).
 *   • a non-SuperAdmin on an admin host → nothing, while it redirects to the tenant host.
 *
 * (An ENTERED org advances past this stage — the scoped console never renders here.) The
 * scope CONTEXT that the console reads once entered is separate — `Scope` in
 * `lib/scope-context` (project/environment selection), mounted in the `ready` providers.
 */
import { useEffect, useState } from 'react'
import { Button, Spinner, Text, XStack, YStack } from '@hanzo/gui'

import { getBrand } from '~/lib/branding/brands'
import { useSession } from '~/lib/auth/session'
import { isSuperAdminAccount } from '~/lib/auth/admin'
import { OrgOnboarding } from '~/components/OrgOnboarding'
import { OrgPicker } from '~/components/OrgPicker'

const LS_BANNER_DISMISSED = 'hz_admin_banner_dismissed'

const onAdminHost = (): boolean =>
  typeof window !== 'undefined' && window.location.hostname.startsWith('admin.')

export function Scope({
  owner,
  entered,
  adminHost,
  superAdmin,
}: {
  owner: string
  entered: boolean | null
  adminHost: boolean
  superAdmin: boolean
}) {
  // A non-SuperAdmin who lands on an admin host is bounced to the tenant console host (the
  // UI twin of the server admin gate). The scoped console never reaches this stage for them
  // (resolve routes adminHost && !superAdmin here); render nothing while the redirect fires.
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (adminHost && owner && !superAdmin) {
      const consoleHost = window.location.hostname.replace(/^admin\./, 'console.')
      window.location.replace(`https://${consoleHost}${window.location.pathname}${window.location.search}`)
    }
  }, [adminHost, owner, superAdmin])

  if (!owner) return <OrgOnboarding />
  if (adminHost && !superAdmin) return null
  if (entered === null) {
    return (
      <YStack flex={1} minH="100vh" items="center" justify="center">
        <Spinner size="large" color="$color11" />
      </YStack>
    )
  }
  return <OrgPicker />
}

/**
 * AdminBanner — a GLOBAL admin browsing a tenant org on a non-admin host gets a
 * dismissible banner pointing at the operator cockpit (admin.<brand>). Self-guarding:
 * renders null for a tenant admin, on an admin host, or once dismissed. Rendered above
 * the dashboard at the `ready` stage.
 */
export function AdminBanner() {
  const { account } = useSession()
  const [dismissed, setDismissed] = useState(true) // start hidden to avoid a flash

  useEffect(() => {
    if (typeof window !== 'undefined') setDismissed(localStorage.getItem(LS_BANNER_DISMISSED) === '1')
  }, [])

  if (!isSuperAdminAccount(account) || onAdminHost() || dismissed) return null

  const brand = getBrand()
  const adminUrl = `https://admin.${brand.adminDomain}`
  const dismiss = () => {
    setDismissed(true)
    if (typeof window !== 'undefined') localStorage.setItem(LS_BANNER_DISMISSED, '1')
  }

  return (
    <XStack
      bg="$yellow2"
      borderBottomWidth={1}
      borderColor="$yellow7"
      px="$4"
      py="$2"
      items="center"
      justify="space-between"
      gap="$3"
      flexWrap="wrap"
    >
      <Text fontSize="$2" color="$yellow11" flex={1}>
        {'IAM, KMS and org administration live on the admin console: '}
        <Text fontSize="$2" color="$yellow12" fontWeight="700">
          {`admin.${brand.adminDomain}`}
        </Text>
      </Text>
      <XStack gap="$2" items="center">
        <Button size="$2" bg="$yellow4" borderColor="$yellow7" onPress={() => window.location.assign(adminUrl)}>
          {`Open admin`}
        </Button>
        <Button size="$2" chromeless theme="yellow" onPress={dismiss} aria-label="Dismiss this notice">
          ✕
        </Button>
      </XStack>
    </XStack>
  )
}
