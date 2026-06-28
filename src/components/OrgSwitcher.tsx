'use client'

/**
 * Org switcher — shows the organization you're acting in, and (only when you
 * actually belong to more than one) lets you switch.
 *
 * Honest by construction: the current org comes from your account; the list comes
 * from IAM (`get-organizations`). Most users belong to one org, so this is just a
 * labelled chip. When several are visible (a multi-brand admin), each brand org
 * routes to that brand's own console host — where it re-authenticates against that
 * brand's IAM — because tenancy is server-side (a brand JWT per host), not a
 * client toggle. We never fabricate orgs: if IAM can't list them, you see your
 * one org.
 */
import { useEffect, useState } from 'react'
import { Button, Popover, Text, XStack, YStack } from '@hanzo/gui'
import { Building2, Check, ChevronsUpDown } from '@hanzogui/lucide-icons-2'

import { config } from '~/config'
import { useSession } from '~/lib/auth/session'
import { IamAdminApi, type Organization } from '~/lib/api'

/** Brand orgs that have their own console host (where switching re-auths). */
const BRAND_CONSOLE_HOST: Record<string, string> = {
  hanzo: 'console.hanzo.ai',
  lux: 'console.lux.cloud',
  zoo: 'console.zoo.cloud',
  pars: 'console.pars.cloud',
}

const titleCase = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)

export function OrgSwitcher() {
  const { account } = useSession()
  const currentId = account?.organization || account?.owner || config.iamOrgName
  const [orgs, setOrgs] = useState<Organization[]>([])
  const [open, setOpen] = useState(false)

  useEffect(() => {
    let live = true
    IamAdminApi.organizations()
      .then((p) => {
        if (live) setOrgs(p.rows ?? [])
      })
      .catch(() => {
        // IAM org listing not available to this account — single-org display.
        if (live) setOrgs([])
      })
    return () => {
      live = false
    }
  }, [])

  const currentName =
    orgs.find((o) => o.name === currentId)?.displayName || titleCase(currentId)

  // Only a real multi-membership turns this into a switcher.
  const others = orgs.filter((o) => o.name !== currentId)
  if (others.length === 0) {
    return (
      <XStack items="center" gap="$2" px="$2.5" height={32} rounded="$3" borderWidth={1} borderColor="$borderColor">
        <Building2 size={14} opacity={0.7} />
        <Text fontSize="$2" color="$color11" numberOfLines={1}>
          {currentName}
        </Text>
      </XStack>
    )
  }

  const select = (org: Organization) => {
    setOpen(false)
    const host = BRAND_CONSOLE_HOST[org.name]
    if (host && org.name !== currentId && typeof window !== 'undefined') {
      window.location.assign(`https://${host}`)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen} placement="bottom-end">
      <Popover.Trigger asChild>
        <Button size="$2" chromeless icon={<Building2 size={14} />} iconAfter={<ChevronsUpDown size={13} />}>
          {currentName}
        </Button>
      </Popover.Trigger>
      <Popover.Content bordered elevate p="$2" width={240} bg="$color2" borderColor="$borderColor">
        <YStack gap="$0.5">
          <Text px="$2" py="$1" fontSize="$1" color="$color10" fontWeight="700" textTransform="uppercase">
            Organizations
          </Text>
          {orgs.map((org) => {
            const isCurrent = org.name === currentId
            const switchable = !isCurrent && Boolean(BRAND_CONSOLE_HOST[org.name])
            return (
              <XStack
                key={org.name}
                onPress={switchable ? () => select(org) : undefined}
                cursor={switchable ? 'pointer' : 'default'}
                items="center"
                gap="$2"
                px="$2"
                py="$2"
                rounded="$3"
                opacity={isCurrent || switchable ? 1 : 0.5}
                hoverStyle={switchable ? { bg: '$color4' } : undefined}
              >
                <Building2 size={14} opacity={0.7} />
                <Text flex={1} fontSize="$2" color="$color12" numberOfLines={1}>
                  {org.displayName || titleCase(org.name)}
                </Text>
                {isCurrent ? <Check size={14} /> : null}
              </XStack>
            )
          })}
        </YStack>
      </Popover.Content>
    </Popover>
  )
}
