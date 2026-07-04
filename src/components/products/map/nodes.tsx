'use client'

/**
 * The one custom canvas node — a monochrome card in the console's design tokens.
 * Every tier (domain / app / resource) renders through it; `data.kind` selects the
 * icon and the card reads its status dot, name, and key fact from `MapNodeData`.
 *
 * Handles exist only to anchor edges — they are invisible and non-interactive
 * (`opacity: 0`), because the graph is DERIVED, never drawn by the user.
 */
import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { Text, XStack, YStack } from '@hanzo/gui'

import type { MapNodeData } from './graph'
import { iconFor, StatusDot } from './presentation'

const HANDLE_STYLE = { opacity: 0, width: 1, height: 1, minWidth: 1, border: 'none', background: 'transparent' } as const

const MapNodeCard = memo(function MapNodeCard({ data, selected }: NodeProps) {
  const d = data as unknown as MapNodeData
  const Icon = iconFor(d)
  return (
    <>
      <Handle type="target" position={Position.Left} style={HANDLE_STYLE} isConnectable={false} />
      <XStack
        width={224}
        items="center"
        gap="$2.5"
        px="$3"
        py="$2.5"
        rounded="$4"
        bg="$color1"
        borderWidth={1}
        borderColor={selected ? '$color8' : '$borderColor'}
        style={{ boxShadow: selected ? '0 0 0 1px var(--color8)' : '0 1px 2px rgba(0,0,0,0.10)' }}
      >
        <YStack width={30} height={30} items="center" justify="center" rounded="$3" bg="$color3">
          <Icon size={16} />
        </YStack>
        <YStack flex={1} gap="$1" minW={0}>
          <XStack items="center" gap="$1.5">
            <StatusDot status={d.status} />
            <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1} flex={1}>
              {d.label}
            </Text>
          </XStack>
          {d.fact ? (
            <Text fontSize="$1" color="$color10" numberOfLines={1}>
              {d.fact}
            </Text>
          ) : null}
        </YStack>
      </XStack>
      <Handle type="source" position={Position.Right} style={HANDLE_STYLE} isConnectable={false} />
    </>
  )
})

/** Module-level (stable identity) node-type map — one card renders every tier. */
export const NODE_TYPES = { service: MapNodeCard } as const
