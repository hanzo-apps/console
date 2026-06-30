'use client'

/**
 * Org switcher — shows the organization the console is scoped to, lets the user
 * switch between the orgs they can see, and CREATE a new one.
 *
 * The org LIST comes from IAM (`get-organizations`, via the gated `/admin/iam`
 * proxy): a global admin sees every org; a tenant whose account can't list gets
 * an empty result and simply sees their current org. Either way the trigger is
 * ALWAYS interactive (so "Create organization" is reachable even with one org).
 * Selecting one re-scopes the console IN PLACE — `switchOrg` persists the choice
 * and reloads so every module refetches under the new `X-Org-Id`.
 *
 * Create posts to the same-origin `/onboard` route: a zero-org user is created +
 * joined as admin; a user who already has an org gets an ADDITIONAL org (created
 * without moving them) and is scope-switched into it. We never fabricate orgs.
 */
import { useEffect, useMemo, useState } from 'react'
import { Button, Input, Popover, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { Building2, Check, ChevronsUpDown, Plus, Search } from '@hanzogui/lucide-icons-2'

import { currentOrg, switchOrg, filterOrgs } from '~/lib/org-scope'
import { IamAdminApi, type Organization } from '~/lib/api'

const titleCase = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)

export function OrgSwitcher() {
  const currentId = currentOrg()
  const [orgs, setOrgs] = useState<Organization[]>([])
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    IamAdminApi.organizations()
      .then((p) => {
        if (live) setOrgs(p.rows ?? [])
      })
      .catch(() => {
        // IAM org listing not available to this account (tenant) — current-org only.
        if (live) setOrgs([])
      })
    return () => {
      live = false
    }
  }, [])

  // Always include the current org so the switcher is meaningful even when the
  // (admin-gated) list is empty for a tenant.
  const allOrgs = useMemo(() => {
    if (orgs.some((o) => o.name === currentId)) return orgs
    return [{ owner: 'admin', name: currentId, displayName: titleCase(currentId) } as Organization, ...orgs]
  }, [orgs, currentId])

  const currentName = allOrgs.find((o) => o.name === currentId)?.displayName || titleCase(currentId)
  const filtered = useMemo(() => filterOrgs(allOrgs, query), [allOrgs, query])

  const select = (org: Organization) => {
    setOpen(false)
    switchOrg(org.name)
  }

  const create = async () => {
    const name = newName.trim()
    if (!name) return
    setBusy(true)
    setErr(null)
    try {
      const res = await fetch('/onboard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const data = (await res.json().catch(() => ({}))) as { org?: string; error?: string }
      if (!res.ok || !data.org) throw new Error(data.error || `Could not create organization (${res.status}).`)
      // Scope into the new org (persists + reloads so every module refetches).
      switchOrg(data.org)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not create the organization.')
      setBusy(false)
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen} placement="bottom-end">
      <Popover.Trigger asChild>
        <Button size="$2" chromeless icon={<Building2 size={14} />} iconAfter={<ChevronsUpDown size={13} />}>
          {currentName}
        </Button>
      </Popover.Trigger>
      <Popover.Content bordered elevate p="$2" width={300} bg="$color2" borderColor="$borderColor">
        {creating ? (
          <YStack gap="$2">
            <Text fontSize="$2" color="$color12" fontWeight="700">
              Create organization
            </Text>
            <Input
              size="$3"
              placeholder="Organization name"
              value={newName}
              onChangeText={setNewName}
              autoCapitalize="words"
              onSubmitEditing={() => void create()}
            />
            {err ? (
              <Text fontSize="$1" color="$red10">
                {err}
              </Text>
            ) : null}
            <XStack gap="$2" justify="flex-end">
              <Button
                size="$2"
                chromeless
                onPress={() => {
                  setCreating(false)
                  setErr(null)
                }}
                disabled={busy}
              >
                Cancel
              </Button>
              <Button
                size="$2"
                onPress={() => void create()}
                disabled={busy || !newName.trim()}
                icon={busy ? <Spinner size="small" /> : <Plus size={14} />}
              >
                Create
              </Button>
            </XStack>
          </YStack>
        ) : (
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
              Organizations · {allOrgs.length}
            </Text>
            <YStack gap="$0.5" maxH={300} overflow="scroll">
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
            <XStack
              onPress={() => {
                setCreating(true)
                setErr(null)
              }}
              cursor="pointer"
              items="center"
              gap="$2"
              px="$2"
              py="$2"
              mt="$1"
              rounded="$3"
              borderTopWidth={1}
              borderColor="$borderColor"
              hoverStyle={{ bg: '$color5' }}
            >
              <Plus size={14} />
              <Text fontSize="$2" color="$color12">
                Create organization
              </Text>
            </XStack>
          </YStack>
        )}
      </Popover.Content>
    </Popover>
  )
}
