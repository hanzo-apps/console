'use client'

/**
 * Step 3 — Your organization. Confirms the org the user is in (created at first-run
 * org onboarding) and lets them optionally NAME it. REAL: reads/writes the org via
 * the org-admin `TeamApi` (`get-organization` / `update-organization`, pinned to the
 * caller's own org server-side). Renaming is best-effort — a read/write failure never
 * blocks the flow (the organization already exists).
 */
import { useEffect, useState } from 'react'
import { Card, Input, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { Building2, Users } from '@hanzogui/lucide-icons-2'

import { useSession } from '~/lib/auth/session'
import { currentOrg } from '~/lib/org-scope'
import { TeamApi } from '~/lib/api/team'
import type { Organization } from '~/lib/api/admin'
import { ApiError } from '~/lib/api/client'
import { useToast } from '~/components/ui/Toast'
import { StepShell, StepActions } from '~/components/onboarding/parts'
import type { StepProps } from '~/components/onboarding/types'

export function TeamStep({ next, skip, back, isFirst }: StepProps) {
  const { account } = useSession()
  const toast = useToast()
  const org = account?.owner || currentOrg()
  const [record, setRecord] = useState<Organization | null>(null)
  const [displayName, setDisplayName] = useState(account?.organization || org)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    void TeamApi.organization(org)
      .then((o) => {
        if (!live) return
        setRecord(o)
        if (o.displayName) setDisplayName(o.displayName)
      })
      .catch(() => {
        /* read-only fallback — keep the session-derived name, no rename */
      })
    return () => {
      live = false
    }
  }, [org])

  const commit = async () => {
    const name = displayName.trim()
    // Persist a rename only when we loaded the org, it's an admin-writable record,
    // and the name actually changed — otherwise just advance.
    if (record && name && name !== record.displayName) {
      setBusy(true)
      try {
        await TeamApi.updateOrganization({ ...record, displayName: name })
        toast.success('Organization renamed', name)
      } catch (e) {
        toast.error('Could not rename the organization', e instanceof ApiError ? e.message : undefined)
      } finally {
        setBusy(false)
      }
    }
    next()
  }

  return (
    <StepShell
      title="Your organization"
      subtitle="This is where your projects, usage, and billing live. Name it now, or keep the default."
      actions={
        <StepActions
          onBack={isFirst ? undefined : back}
          onSkip={skip}
          skipLabel="Keep the default"
          onContinue={() => void commit()}
          continueLabel="Continue"
          busy={busy}
        />
      }
    >
      <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor">
        <XStack gap="$3" items="center">
          <YStack width={44} height={44} rounded="$4" items="center" justify="center" bg="$color3">
            <Building2 size={22} />
          </YStack>
          <YStack flex={1} minW={0} gap="$0.5">
            <Text fontSize="$5" fontWeight="700" color="$color12">
              {displayName || org}
            </Text>
            <Text fontSize="$2" color="$color10">
              Identifier: {org}
            </Text>
          </YStack>
        </XStack>

        {record ? (
          <YStack gap="$1.5">
            <Text fontSize="$2" color="$color11" fontWeight="600">
              Organization name
            </Text>
            <Input value={displayName} onChangeText={setDisplayName} placeholder="Acme Inc" autoCapitalize="words" />
          </YStack>
        ) : null}
      </Card>

      <XStack gap="$2" items="center">
        <Users size={16} color="var(--color10)" />
        <Text fontSize="$2" color="$color10">
          Invite teammates and switch organizations anytime from the top bar.
        </Text>
      </XStack>
    </StepShell>
  )
}
