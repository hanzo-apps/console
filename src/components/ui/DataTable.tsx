'use client'

/**
 * Generic data table — the shared list primitive for every product module.
 *
 * Rows are typed `<T>`; columns declare a key, header, and optional cell
 * renderer. Built on Hanzo GUI Stacks (shorthand style props per the v5 config)
 * so it adapts across platforms. Loading and empty states are first-class.
 */
import type { ReactNode } from 'react'
import { Spinner, Text, XStack, YStack } from '@hanzo/gui'

export type Column<T> = {
  key: string
  header: string
  /** Cell renderer; defaults to `String(row[key])`. */
  render?: (row: T) => ReactNode
  /** Fixed width (px) for the column; otherwise flexes. */
  width?: number
}

export function DataTable<T>({
  columns,
  rows,
  loading,
  empty = 'Nothing here yet.',
  rowKey,
  onRowPress,
}: {
  columns: Column<T>[]
  rows: T[]
  loading?: boolean
  empty?: string
  rowKey: (row: T) => string
  onRowPress?: (row: T) => void
}) {
  if (loading) {
    return (
      <XStack p="$6" justify="center">
        <Spinner size="large" color="$color11" />
      </XStack>
    )
  }

  if (rows.length === 0) {
    return (
      <YStack p="$6" items="center" borderWidth={1} borderColor="$borderColor" rounded="$4">
        <Text color="$color11">{empty}</Text>
      </YStack>
    )
  }

  // Natural min-width of the table: the sum of the declared column widths, with a
  // sensible floor for flex columns, plus row padding + inter-column gaps. On a
  // narrow (mobile) viewport where this exceeds the container, the inner wrapper
  // scrolls HORIZONTALLY instead of clipping the last columns (the old
  // `overflow:hidden` cut the right edge off, e.g. the Status column). On desktop
  // the flex columns still expand to fill, so wide screens are unchanged.
  const minTableW = columns.reduce((sum, c) => sum + (c.width ?? FLEX_MIN_COL_W), 0) + (columns.length + 1) * 12

  return (
    <YStack borderWidth={1} borderColor="$borderColor" rounded="$4" overflow="hidden">
      <YStack style={{ overflowX: 'auto', overflowY: 'visible' }}>
        <YStack minW={minTableW}>
          <XStack bg="$color2" py="$2.5" px="$3" gap="$3">
            {columns.map((c) => (
              <Text
                key={c.key}
                width={c.width}
                flex={c.width ? undefined : 1}
                minW={c.width ? undefined : FLEX_MIN_COL_W}
                fontSize="$2"
                fontWeight="700"
                color="$color11"
              >
                {c.header}
              </Text>
            ))}
          </XStack>
          <YStack>
            {rows.map((row) => (
              <XStack
                key={rowKey(row)}
                py="$2.5"
                px="$3"
                gap="$3"
                borderTopWidth={1}
                borderColor="$borderColor"
                items="center"
                hoverStyle={onRowPress ? { bg: '$color2' } : undefined}
                cursor={onRowPress ? 'pointer' : undefined}
                onPress={onRowPress ? () => onRowPress(row) : undefined}
              >
                {columns.map((c) => (
                  <YStack key={c.key} width={c.width} flex={c.width ? undefined : 1} minW={c.width ? undefined : FLEX_MIN_COL_W}>
                    {c.render ? (
                      c.render(row)
                    ) : (
                      <Text fontSize="$3" numberOfLines={1}>
                        {String((row as Record<string, unknown>)[c.key] ?? '')}
                      </Text>
                    )}
                  </YStack>
                ))}
              </XStack>
            ))}
          </YStack>
        </YStack>
      </YStack>
    </YStack>
  )
}

/** Min width for a flex (no explicit `width`) column, so the table has a natural
 *  size to scroll to on mobile instead of squishing/clipping its cells. */
const FLEX_MIN_COL_W = 120
