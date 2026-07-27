'use client'

/**
 * Sidebar customization panes — the CONTENT the DetailPane renders when a user
 * customizes their sidebar. Two surfaces, both backed by the ONE account-persisted
 * store (`usePins` + `useProductColors`), so every choice follows the user:
 *
 *  - `ProductCustomize` — set a single product's icon COLOR, PIN it, and file it
 *    into a GROUP. Opened from a product row's color dot.
 *  - `ManagePins` — the full manager: DRAG to reorder within a group, create /
 *    rename / remove groups, move a pin between groups, unpin. Opened from the
 *    "Manage" affordance on the Pinned header.
 *
 * These are pane bodies (rendered inside `DetailPane`), not their own overlays —
 * the pane chrome (slide, backdrop, close) is the shared `SlideOver`.
 */
import { useState } from 'react'
import { Button, Input, Text, XStack, YStack } from '@hanzo/gui'
import { Check, GripVertical, Plus, Star, X } from '@hanzogui/lucide-icons-2'

import { COLOR_SWATCHES } from '~/lib/products/colors'
import { DEFAULT_GROUP, DEFAULT_GROUP_LABEL, type PinGroupView } from '~/lib/products/pins-core'
import { usePins, useProductColors } from '~/lib/products/pins'
import { findEntry } from '~/lib/products/registry'
import { Reorder } from '@hanzo/ui/product'
import { asColor } from '@hanzo/ui/product'

/** A round color swatch button; ringed + checked when selected. */
function SwatchButton({ hex, selected, onPress }: { hex: string; selected: boolean; onPress: () => void }) {
  return (
    <XStack
      onPress={onPress}
      cursor="pointer"
      width={32}
      height={32}
      rounded="$10"
      items="center"
      justify="center"
      borderWidth={2}
      borderColor={selected ? '$color12' : 'transparent'}
      hoverStyle={{ borderColor: selected ? '$color12' : '$color8' }}
      style={{ backgroundColor: hex }}
      aria-label={selected ? 'Selected color' : 'Set color'}
    >
      {selected ? <Check size={16} color={asColor('#ffffff')} /> : null}
    </XStack>
  )
}

/** A pressable group chip (default bucket, a named group, or the active state). */
function GroupChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <XStack
      onPress={onPress}
      cursor="pointer"
      px="$2.5"
      py="$1.5"
      rounded="$10"
      borderWidth={1}
      borderColor={active ? '$color8' : '$borderColor'}
      bg={active ? '$color5' : 'transparent'}
      hoverStyle={{ bg: active ? '$color5' : '$color3' }}
    >
      <Text fontSize="$2" fontWeight="600" color="$color12">
        {label}
      </Text>
    </XStack>
  )
}

/** New-group input + add — shared by both panes. */
function NewGroup({ onAdd }: { onAdd: (name: string) => void }) {
  const [name, setName] = useState('')
  const add = () => {
    const n = name.trim()
    if (!n) return
    onAdd(n)
    setName('')
  }
  return (
    <XStack items="center" gap="$2">
      <XStack
        flex={1}
        items="center"
        gap="$2"
        px="$2.5"
        height={36}
        rounded="$3"
        borderWidth={1}
        borderColor="$borderColor"
        bg="$color2"
      >
        <Input
          flex={1}
          unstyled
          value={name}
          onChangeText={setName}
          placeholder="New group…"
          fontSize="$3"
          color="$color12"
          autoCapitalize="none"
          onSubmitEditing={add}
        />
      </XStack>
      <Button size="$3" icon={<Plus size={16} />} onPress={add} disabled={!name.trim()}>
        Add
      </Button>
    </XStack>
  )
}

// ── Single-product customize ─────────────────────────────────────────────────

export function ProductCustomize({ id }: { id: string }) {
  const entry = findEntry(id)
  const { keyOf, setColor, resetColor } = useProductColors()
  const { isPinned, toggle, assign, view, manageView, addGroup } = usePins()
  const activeKey = keyOf(id)
  const pinned = isPinned(id)
  const groupOf =
    view.flatMap((g) => g.entries.map((e) => ({ id: e.id, group: g.name }))).find((e) => e.id === id)?.group ??
    DEFAULT_GROUP
  const groups = manageView.map((g) => g.name)

  if (!entry) return <Text color="$color10">Unknown product.</Text>

  return (
    <YStack gap="$5">
      {/* Color */}
      <YStack gap="$2.5">
        <XStack items="center" justify="space-between">
          <Text fontSize="$2" color="$color11" fontWeight="700" textTransform="uppercase">
            Icon color
          </Text>
          <Button size="$1" chromeless onPress={() => resetColor(id)}>
            <Text fontSize="$1" color="$color10">
              Reset
            </Text>
          </Button>
        </XStack>
        <XStack flexWrap="wrap" gap="$2.5">
          {COLOR_SWATCHES.map((s) => (
            <SwatchButton key={s.key} hex={s.hex} selected={s.key === activeKey} onPress={() => setColor(id, s.key)} />
          ))}
        </XStack>
      </YStack>

      {/* Pin */}
      <YStack gap="$2.5">
        <Text fontSize="$2" color="$color11" fontWeight="700" textTransform="uppercase">
          Pin
        </Text>
        <Button
          justify="flex-start"
          icon={<Star size={16} />}
          onPress={() => toggle(id)}
          bg={pinned ? '$color5' : 'transparent'}
          borderWidth={1}
          borderColor="$borderColor"
        >
          {pinned ? 'Pinned to sidebar' : 'Pin to sidebar'}
        </Button>
      </YStack>

      {/* Group (only meaningful once pinned) */}
      {pinned ? (
        <YStack gap="$2.5">
          <Text fontSize="$2" color="$color11" fontWeight="700" textTransform="uppercase">
            Group
          </Text>
          <XStack flexWrap="wrap" gap="$2">
            <GroupChip label={DEFAULT_GROUP_LABEL} active={groupOf === DEFAULT_GROUP} onPress={() => assign(id, DEFAULT_GROUP)} />
            {groups
              .filter((g) => g !== DEFAULT_GROUP)
              .map((g) => (
                <GroupChip key={g} label={g} active={groupOf === g} onPress={() => assign(id, g)} />
              ))}
          </XStack>
          <NewGroup
            onAdd={(name) => {
              addGroup(name)
              assign(id, name)
            }}
          />
        </YStack>
      ) : null}
    </YStack>
  )
}

// ── Full pins manager ────────────────────────────────────────────────────────

/** One draggable pinned row inside a group (icon + label + move-to-group + unpin). */
function PinRow({
  id,
  groups,
  currentGroup,
  colorOf,
  onAssign,
  onUnpin,
  handle,
}: {
  id: string
  groups: string[]
  currentGroup: string
  colorOf: (id: string) => string
  onAssign: (id: string, group: string) => void
  onUnpin: (id: string) => void
  handle: { onPointerDown: (e: never) => void }
}) {
  const entry = findEntry(id)
  const Icon = entry?.icon
  return (
    <XStack items="center" gap="$2" px="$2" height={44} rounded="$3" bg="$color2" borderWidth={1} borderColor="$borderColor">
      <XStack
        {...handle}
        cursor="grab"
        px="$1"
        py="$2"
        opacity={0.6}
        hoverStyle={{ opacity: 1 }}
        aria-label="Drag to reorder"
      >
        <GripVertical size={16} />
      </XStack>
      {Icon ? <Icon size={16} color={asColor(colorOf(id))} /> : null}
      <Text flex={1} fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>
        {entry?.label ?? id}
      </Text>
      {groups.length > 1 ? (
        <XStack items="center" gap="$1">
          {groups.map((g) => (
            <XStack
              key={g || 'default'}
              onPress={() => onAssign(id, g)}
              cursor="pointer"
              width={18}
              height={18}
              rounded="$10"
              items="center"
              justify="center"
              borderWidth={1}
              borderColor={g === currentGroup ? '$color12' : '$borderColor'}
              bg={g === currentGroup ? '$color12' : 'transparent'}
              aria-label={`Move to ${g || DEFAULT_GROUP_LABEL}`}
            />
          ))}
        </XStack>
      ) : null}
      <Button size="$1" chromeless icon={<X size={15} />} onPress={() => onUnpin(id)} aria-label="Unpin" />
    </XStack>
  )
}

function ManageGroup({
  group,
  groups,
  colorOf,
  onReorder,
  onAssign,
  onUnpin,
  onRename,
  onRemove,
}: {
  group: PinGroupView
  groups: string[]
  colorOf: (id: string) => string
  onReorder: (group: string, from: number, to: number) => void
  onAssign: (id: string, group: string) => void
  onUnpin: (id: string) => void
  onRename: (from: string, to: string) => void
  onRemove: (name: string) => void
}) {
  const [rename, setRename] = useState(group.label)
  const named = group.name !== DEFAULT_GROUP
  return (
    <YStack gap="$2">
      <XStack items="center" gap="$2">
        {named ? (
          <XStack flex={1} items="center" gap="$2" px="$2.5" height={32} rounded="$3" borderWidth={1} borderColor="$borderColor" bg="$color2">
            <Input
              flex={1}
              unstyled
              value={rename}
              onChangeText={setRename}
              onSubmitEditing={() => onRename(group.name, rename)}
              onBlur={() => onRename(group.name, rename)}
              fontSize="$2"
              fontWeight="700"
              color="$color12"
            />
          </XStack>
        ) : (
          <Text flex={1} fontSize="$1" color="$color10" fontWeight="700" textTransform="uppercase">
            {group.label}
          </Text>
        )}
        {named ? (
          <Button size="$1" chromeless icon={<X size={14} />} onPress={() => onRemove(group.name)} aria-label={`Remove ${group.label}`} />
        ) : null}
      </XStack>

      {group.entries.length === 0 ? (
        <Text px="$2" py="$2" fontSize="$2" color="$color10">
          Empty — move a pin here.
        </Text>
      ) : (
        <Reorder
          items={group.entries}
          keyOf={(e) => e.id}
          rowHeight={48}
          onReorder={(from, to) => onReorder(group.name, from, to)}
          renderItem={(e, h) => (
            <PinRow
              id={e.id}
              groups={groups}
              currentGroup={group.name}
              colorOf={colorOf}
              onAssign={onAssign}
              onUnpin={onUnpin}
              handle={h as { onPointerDown: (e: never) => void }}
            />
          )}
        />
      )}
    </YStack>
  )
}

export function ManagePins() {
  const { manageView, move, assign, unpin, addGroup, removeGroup, renameGroup } = usePins()
  const { colorOf } = useProductColors()
  const groupNames = manageView.map((g) => g.name)

  return (
    <YStack gap="$5">
      <Text fontSize="$2" color="$color10">
        Drag the handle to reorder. Use the dots to move a pin between groups. Create groups to organize your sidebar.
      </Text>

      {manageView.map((group) => (
        <ManageGroup
          key={group.name || 'default'}
          group={group}
          groups={groupNames}
          colorOf={colorOf}
          onReorder={(g, from, to) => {
            const entry = manageView.find((v) => v.name === g)?.entries[from]
            if (entry) move(entry.id, g, to)
          }}
          onAssign={assign}
          onUnpin={unpin}
          onRename={renameGroup}
          onRemove={removeGroup}
        />
      ))}

      <YStack gap="$2">
        <Text fontSize="$1" color="$color10" fontWeight="700" textTransform="uppercase">
          New group
        </Text>
        <NewGroup onAdd={addGroup} />
      </YStack>
    </YStack>
  )
}
