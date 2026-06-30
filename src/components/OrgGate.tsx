'use client'

/**
 * Org gate — the console operates inside the user's organization.
 *
 * Behaviours:
 *   1. isAdmin on a non-admin host → show a dismissible amber banner linking to
 *      admin.hanzo.ai (IAM/KMS ops), but render the full console. Admins use the
 *      console for all normal cloud work (models, API keys, AI, etc.).
 *   2. Any non-admin user in any org → render console normally.
 *   3. No org yet → first-run org onboarding.
 *
 * Switching orgs at runtime is the OrgSwitcher's job; this gate only covers
 * the "no org" degenerate case and the admin hint.
 *
 * Last org: restored from localStorage on sign-in so the scope remembers where
 * the user left off.
 */
import { useEffect, useState, type ReactNode } from 'react'
import { Button, Text, XStack, YStack } from '@hanzo/gui'

import { config } from '~/config'
import { getBrand } from '~/lib/branding/brands'
import { useSession } from '~/lib/auth/session'
import { currentOrg, setCurrentOrg } from '~/lib/org-scope'
import { OrgOnboarding } from '~/components/OrgOnboarding'

const LS_LAST_ORG = 'hz_last_org'
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
  // GLOBAL (cross-tenant) admin — the only one who may use admin.hanzo.ai.
  // MEMBERSHIP in the reserved `admin` org IS global admin (its whole purpose is
  // the seeded superuser z@<domain>). We must NOT also require `isAdmin`: IAM never
  // populates `isGlobalAdmin` (always absent) and admin-org members carry
  // `isAdmin=false`, so `&& isAdmin` made NO ONE a global admin → every legitimate
  // admin was bounced from admin.hanzo.ai back to the console (the redirect loop).
  // A tenant org owner (e.g. Dave/maxpower) has owner!=='admin' → never global.
  const isGlobalAdmin =
    Boolean((account as { isGlobalAdmin?: boolean } | null)?.isGlobalAdmin) ||
    owner === 'admin'
  const [bannerDismissed, setBannerDismissed] = useState(true) // start hidden to avoid flash

  // Restore banner dismissed state and last org on mount
  useEffect(() => {
    if (typeof window === 'undefined') return
    const dismissed = localStorage.getItem(LS_BANNER_DISMISSED) === '1'
    setBannerDismissed(dismissed)
  }, [])

  // Seed org scope from localStorage on sign-in (restores last selected org)
  useEffect(() => {
    if (!owner || typeof window === 'undefined') return
    const lastOrg = localStorage.getItem(LS_LAST_ORG)
    if (currentOrg() === config.iamOrgName) {
      const target = (lastOrg && lastOrg !== config.iamOrgName) ? lastOrg : owner
      if (target !== config.iamOrgName) setCurrentOrg(target)
    }
    // Persist current org whenever it updates
    const cur = currentOrg()
    if (cur && cur !== config.iamOrgName) localStorage.setItem(LS_LAST_ORG, cur)
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

  // GLOBAL admin on a non-admin host: show dismissible banner, render console
  // normally. Org-level admins (org owners) never see it — admin.hanzo.ai is
  // cross-tenant ops they cannot use.
  const showBanner = isGlobalAdmin && !onAdminHost() && !bannerDismissed

  return (
    <YStack flex={1}>
      {showBanner && <AdminBanner onDismiss={dismissBanner} />}
      {children}
    </YStack>
  )
}
