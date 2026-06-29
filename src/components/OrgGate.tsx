'use client'

/**
 * Org gate — the console operates inside the user's CUSTOMER organization.
 *
 * Orthogonal to {@link AuthGate} (which only answers "is there a session?"): this
 * answers "is the session's org usable on this customer console?". Two rules:
 *
 *  1. The brand's OWN org (`config.iamOrgName` — e.g. `hanzo`) is the internal,
 *     admin-protected tenant. A user who resolves to it is staff, not a customer,
 *     so on a CUSTOMER host we never run the console as that org — we send them to
 *     the brand's admin host (`admin.<adminDomain>`). The SAME image serves the
 *     admin host, where the internal org belongs; so the block is scoped to
 *     non-admin hosts (otherwise the redirect would loop). (HIP: console2 is for
 *     customers in their OWN orgs; staff live on the admin host.)
 *  2. A session with no org can't scope anything — we surface an honest "no
 *     organization" state rather than render an unscoped console.
 *
 * Switching BETWEEN customer orgs (multi-membership) is the shell's `OrgSwitcher`
 * job; this gate only refuses the two unusable cases.
 */
import { useEffect, type ReactNode } from 'react'
import { Button, Card, Text, YStack } from '@hanzo/gui'

import { config } from '~/config'
import { getBrand } from '~/lib/branding/brands'
import { useSession } from '~/lib/auth/session'
import { currentOrg, setCurrentOrg } from '~/lib/org-scope'

/** The admin host (`admin.<domain>`) is the staff surface — the internal org is
 * welcome there, so the block (rule 1) applies only OFF this host. */
function onAdminHost(): boolean {
  return typeof window !== 'undefined' && window.location.hostname.startsWith('admin.')
}

function GateCard({ title, body, children }: { title: string; body: string; children?: ReactNode }) {
  return (
    <YStack flex={1} minH="100vh" items="center" justify="center" p="$4">
      <Card p="$5" gap="$4" width={420} borderWidth={1} borderColor="$borderColor" bg="$color1">
        <YStack gap="$2">
          <Text fontSize="$7" fontWeight="800">
            {title}
          </Text>
          <Text fontSize="$3" color="$color11">
            {body}
          </Text>
        </YStack>
        {children}
      </Card>
    </YStack>
  )
}

export function OrgGate({ children }: { children: ReactNode }) {
  const { account, signOut } = useSession()

  // AuthGate guarantees an account by the time this renders; guard anyway.
  const owner = account?.owner ?? ''

  // A customer's console acts in THEIR org. The org-scope module defaults to the
  // brand org (designed for the cross-org admin), so on a customer host seed the
  // signed-in user's own org as the active scope the FIRST time — i.e. only when
  // no explicit switch is in effect yet (current scope is still the brand org).
  // This makes the OrgSwitcher chip + the `X-Org-Id` client stamp reflect the
  // real tenant, and never clobbers an admin's deliberate org switch.
  useEffect(() => {
    if (owner && owner !== config.iamOrgName && !onAdminHost() && currentOrg() === config.iamOrgName) {
      setCurrentOrg(owner)
    }
  }, [owner])

  // Rule 1 — internal brand org → brand admin console (customer hosts only; the
  // admin host serves this same image and is where the internal org belongs, so
  // blocking there would bounce the operator back into a redirect loop).
  if (owner && owner === config.iamOrgName && !onAdminHost()) {
    const brand = getBrand()
    const adminUrl = `https://admin.${brand.adminDomain}`
    return (
      <GateCard
        title={`${brand.brandName} Admin`}
        body={`The ${brand.brandName} Cloud console is for customer organizations. Staff administration for the ${brand.brandName} organization lives in the admin console.`}
      >
        <YStack gap="$2.5">
          {/* Single string child — a "Go to admin." text node + the {domain}
              expression would be laid out as two children with the Button's flex
              gap between them, rendering a stray space (admin. hanzo.ai). */}
          <Button size="$4" onPress={() => window.location.assign(adminUrl)}>
            {`Go to admin.${brand.adminDomain}`}
          </Button>
          <Button size="$3" chromeless onPress={() => void signOut()}>
            Sign out
          </Button>
        </YStack>
      </GateCard>
    )
  }

  // Rule 2 — a session with no organization can't scope the console.
  if (!owner) {
    return (
      <GateCard
        title="No organization"
        body="Your account isn't part of an organization yet. An organization owner needs to invite you, or you can create one to get started."
      >
        <Button size="$3" chromeless onPress={() => void signOut()}>
          Sign out
        </Button>
      </GateCard>
    )
  }

  return <>{children}</>
}
