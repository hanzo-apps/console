'use client'

/**
 * Org switcher — shows the organization the console is scoped to, and lets an
 * operator who can see more than one switch + filter between them.
 *
 * The org LIST comes from IAM (`get-organizations`, via the gated `/admin/iam`
 * proxy): a global admin (z@hanzo.ai) sees every org; a brand admin sees their
 * own. Selecting one re-scopes the console IN PLACE — `setCurrentOrg` persists
 * the choice and a reload refetches every module under the new `X-Org-Id`
 * (`currentOrg()`); the IAM/KMS proxies authorize a global admin for any org and
 * pin a brand admin to their own, so the re-scope is always safe. Brand identity
 * (the host's wordmark/logo) is unchanged — only the data scope moves. We never
 * fabricate orgs: if IAM lists one, this is just a labelled chip.
 */
import { useEffect, useMemo, useState } from 'react'
import { Button, Input, Popover, Text, XStack, YStack } from '@hanzo/gui'
import { Building2, Check, ChevronsUpDown, Search } from '@hanzogui/lucide-icons-2'

import { currentOrg, setCurrentOrg, filterOrgs } from '~/lib/org-scope'
import { IamAdminApi, type Organization } from '~/lib/api'

const titleCase = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)

export function OrgSwitcher() {
  const currentId = currentOrg()
  const [orgs, setOrgs] = useState<Organization[]>([])
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

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

  const currentName = orgs.find((o) => o.name === currentId)?.displayName || titleCase(currentId)
  const filtered = useMemo(() => filterOrgs(orgs, query), [orgs, query])

  // A single visible org is just a label — there is nothing to switch to.
  if (orgs.length <= 1) {
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
    if (org.name === currentId) return
    setCurrentOrg(org.name)
    if (typeof window !== 'undefined') window.location.reload()
  }

  return (
    <Popover open={open} onOpenChange={setOpen} placement="bottom-end">
      <Popover.Trigger asChild>
        <Button size="$2" chromeless icon={<Building2 size={14} />} iconAfter={<ChevronsUpDown size={13} />}>
          {currentName}
        </Button>
      </Popover.Trigger>
      <Popover.Content bordered elevate p="$2" width={288} bg="$color2" borderColor="$borderColor">
        <YStack gap="$1">
          <XStack items="center" gap="$2" px="$2" py="$1" rounded="$3" borderWidth={1} borderColor="$borderColor">
            <Search size={13} opacity={0.6} />
            <Input
              flex={1}
              size="$2"
              borderWidth={0}
              bg="transparent"
              placeholder="Filter organizations…"
              value={query}
              onChangeText={setQuery}
              autoCapitalize="none"
            />
          </XStack>
          <Text px="$2" py="$1" fontSize="$1" color="$color10" fontWeight="700" textTransform="uppercase">
            Organizations · {orgs.length}
          </Text>
          <YStack gap="$0.5" maxH={320} overflow="scroll">
            {filtered.length === 0 ? (
              <Text px="$2" py="$2" fontSize="$2" color="$color10">
                No organizations match “{query}”.
              </Text>
            ) : (
              filtered.map((org) => {
                const isCurrent = org.name === currentId
                return (
                  <XStack
                    key={`${org.owner}/${org.name}`}
                    onPress={() => select(org)}
                    cursor="pointer"
                    items="center"
                    gap="$2"
                    px="$2"
                    py="$2"
                    rounded="$3"
                    bg={isCurrent ? '$color4' : 'transparent'}
                    hoverStyle={{ bg: '$color5' }}
                  >
                    <Building2 size={14} opacity={0.7} />
                    <Text flex={1} fontSize="$2" color="$color12" numberOfLines={1}>
                      {org.displayName || titleCase(org.name)}
                    </Text>
                    {isCurrent ? <Check size={14} /> : null}
                  </XStack>
                )
              })
            )}
          </YStack>
        </YStack>
      </Popover.Content>
    </Popover>
  )
}
