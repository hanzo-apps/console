'use client'

/**
 * Org gate — the two-level org model's router. EVERY login lands org-LESS.
 *
 * Route:
 *   0. No org at all → first-run org onboarding (create/join).
 *   1. Has org(s) but none ENTERED yet → the {@link OrgPicker} (the "Home" org
 *      list). A one-org user still sees a one-card list and clicks in; a global
 *      admin sees every org (masquerade). We never auto-enter.
 *   2. An org is entered → the scoped console (children). A global admin on a
 *      non-admin host also gets a dismissible banner linking to admin.hanzo.ai.
 *
 * Entering/leaving an org is `org-scope`'s job (`enterOrg`/`leaveOrg`, which
 * reload); in-shell quick-switching is the OrgSwitcher's. This gate only decides
 * which of the three surfaces to show, read fresh on mount to avoid a flash.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { Button, Spinner, Text, XStack, YStack } from '@hanzo/gui'

import { getBrand } from '~/lib/branding/brands'
import { useSession } from '~/lib/auth/session'
import { isGlobalAdminAccount } from '~/lib/auth/admin'
import { hasSelectedOrg } from '~/lib/org-scope'
import { OrgOnboarding } from '~/components/OrgOnboarding'
import { OrgPicker } from '~/components/OrgPicker'

const LS_BANNER_DISMISSED = 'hz_admin_banner_dismissed'

function onAdminHost(): boolean {
  return typeof window !== 'undefined' && window.location.hostname.startsWith('admin.')
}

function AdminBanner({ onDismiss }: { onDismiss: () => void }) {
  const brand = getBrand()
  const adminUrl = `https://admin.${brand.adminDomain}`
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
        {'Admin ops (IAM · KMS · orgs) → '}
        <Text fontSize="$2" color="$yellow12" fontWeight="700">
          {`admin.${brand.adminDomain}`}
        </Text>
      </Text>
      <XStack gap="$2" items="center">
        <Button
          size="$2"
          bg="$yellow4"
          borderColor="$yellow7"
          onPress={() => window.location.assign(adminUrl)}
        >
          {`Open admin`}
        </Button>
        <Button size="$2" chromeless theme="yellow" onPress={onDismiss}>
          ✕
        </Button>
      </XStack>
    </XStack>
  )
}

export function OrgGate({ children }: { children: ReactNode }) {
  const { account } = useSession()
  const owner = account?.owner ?? ''
  // GLOBAL (cross-tenant) admin — the only one who may use admin.hanzo.ai. The
  // decision (membership in the reserved `admin` org, or an explicit isGlobalAdmin
  // claim) lives in ONE place — `isGlobalAdminAccount` — shared with the nav gate.
  // A tenant org owner (e.g. Dave/maxpower) has owner!=='admin' → never global.
  const isGlobalAdmin = isGlobalAdminAccount(account)
  const [bannerDismissed, setBannerDismissed] = useState(true) // start hidden to avoid flash
  // Which surface to show — resolved on mount (localStorage is client-only) so the
  // picker vs. scoped-console decision never flashes the wrong one during hydration.
  const [selected, setSelected] = useState<boolean | null>(null)

  // Restore banner dismissed state + read the org selection on mount.
  useEffect(() => {
    if (typeof window === 'undefined') return
    setBannerDismissed(localStorage.getItem(LS_BANNER_DISMISSED) === '1')
    setSelected(hasSelectedOrg())
  }, [owner])

  const dismissBanner = () => {
    setBannerDismissed(true)
    if (typeof window !== 'undefined') localStorage.setItem(LS_BANNER_DISMISSED, '1')
  }

  // admin.hanzo.ai is GLOBAL-admin-only (cross-tenant IAM/KMS/orgs ops). A
  // non-global-admin who lands here — e.g. an org owner like Dave/maxpower — is
  // bounced to the regular console host; they never reach the admin surfaces (the
  // server /admin/* proxies also fail-closed, this is the matching UI gate).
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (onAdminHost() && owner && !isGlobalAdmin) {
      const consoleHost = window.location.hostname.replace(/^admin\./, 'console.')
      window.location.replace(`https://${consoleHost}${window.location.pathname}${window.location.search}`)
    }
  }, [owner, isGlobalAdmin])

  // No org yet → first-run onboarding
  if (!owner) {
    return <OrgOnboarding />
  }

  // On the admin host but not a global admin → render nothing while the redirect
  // above fires, so the admin console never flashes for an unauthorized user.
  if (onAdminHost() && !isGlobalAdmin) {
    return null
  }

  // Selection not read yet (pre-hydration) → a brief neutral loader, so the picker
  // and the scoped console never flash in the wrong order.
  if (selected === null) {
    return (
      <YStack flex={1} minH="100vh" items="center" justify="center">
        <Spinner size="large" color="$color11" />
      </YStack>
    )
  }

  // Has org(s) but none entered → the org-less picker (the "Home" list). Every
  // login lands here; a one-org user clicks their single card in.
  if (!selected) {
    return <OrgPicker />
  }

  // An org is entered → the scoped console. A GLOBAL admin on a non-admin host also
  // gets the dismissible admin banner; org owners never see it (admin.hanzo.ai is
  // cross-tenant ops they cannot use).
  const showBanner = isGlobalAdmin && !onAdminHost() && !bannerDismissed

  return (
    <YStack flex={1}>
      {showBanner && <AdminBanner onDismiss={dismissBanner} />}
      {children}
    </YStack>
  )
}
