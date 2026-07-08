'use client'

/**
 * Add product — the out-of-box "assemble your own backend" flow. Lists every
 * product the org has NOT yet enabled (brand-scoped, non-admin, minus the always-on
 * essentials), grouped by category, each with an "Enable" action that POSTs the
 * entitlement patch and drops the product into the org's sidebar. Rendered in the
 * shared DetailPane (opened from the sidebar's "Add product" row).
 *
 * Honest by construction: it derives from the ONE catalog + the live entitlement
 * set, shows the real enable state (Enabling…/Enabled), surfaces an error inline,
 * and shows an honest empty state when nothing is left to add.
 */
import { useMemo, useState } from 'react'
import { Button, Text, XStack, YStack } from '@hanzo/gui'
import { Check, Plus } from '@hanzogui/lucide-icons-2'

import { addableCatalogByCategory, type CatalogEntry } from '~/lib/products/registry'
import { useEntitlements } from '~/lib/entitlements-context'
import { useIsSuperAdmin } from '~/lib/auth/admin'
import { useProductColors } from '~/lib/products/pins'
import { asColor } from '~/components/ui/color'
import { EmptyState } from '~/components/ui/EmptyState'

function AddRow({ entry, onEnable }: { entry: CatalogEntry; onEnable: () => Promise<void> }) {
  const { colorOf } = useProductColors()
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle')
  const Icon = entry.icon
  const enable = async () => {
    setState('busy')
    try {
      await onEnable()
      setState('done')
    } catch {
      setState('error')
    }
  }
  return (
    <XStack items="center" gap="$3" py="$2" px="$2" rounded="$3" hoverStyle={{ bg: '$color2' }}>
      <YStack width={30} height={30} rounded="$3" bg="$color3" items="center" justify="center">
        <Icon size={16} color={asColor(colorOf(entry.id))} />
      </YStack>
      <YStack flex={1} minW={0}>
        <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>
          {entry.label}
        </Text>
        <Text fontSize="$1" color="$color10" numberOfLines={1}>
          {entry.description}
        </Text>
        {state === 'error' ? (
          <Text fontSize="$1" color="$red10">
            Could not enable — try again.
          </Text>
        ) : null}
      </YStack>
      {state === 'done' ? (
        <XStack items="center" gap="$1.5" px="$2">
          <Check size={14} color="$green10" />
          <Text fontSize="$2" color="$green10" fontWeight="600">
            Enabled
          </Text>
        </XStack>
      ) : (
        <Button
          size="$2"
          icon={<Plus size={14} />}
          disabled={state === 'busy'}
          onPress={enable}
          aria-label={`Enable ${entry.label}`}
        >
          {state === 'busy' ? 'Enabling…' : 'Enable'}
        </Button>
      )}
    </XStack>
  )
}

export function AddProductPanel() {
  const showAdmin = useIsSuperAdmin()
  const { enabled, addProducts } = useEntitlements()
  const groups = useMemo(() => addableCatalogByCategory(showAdmin, enabled), [showAdmin, enabled])

  if (groups.length === 0) {
    return (
      <YStack p="$4">
        <EmptyState
          icon={Check}
          title="Everything's enabled"
          description="Your organization has enabled every available product. New products appear here as they launch."
        />
      </YStack>
    )
  }

  return (
    <YStack p="$3" gap="$4">
      <Text fontSize="$2" color="$color10">
        Enable products to add them to your organization's console. You only pay for what you use.
      </Text>
      {groups.map((group) => (
        <YStack key={group.category} gap="$1">
          <Text fontSize="$1" color="$color10" fontWeight="700" textTransform="uppercase" px="$2">
            {group.category}
          </Text>
          {group.entries.map((entry) => (
            <AddRow key={entry.id} entry={entry} onEnable={() => addProducts([entry.id])} />
          ))}
        </YStack>
      ))}
    </YStack>
  )
}
