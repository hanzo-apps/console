'use client'

/**
 * Generic data table — the shared list primitive for every product module.
 *
 * Rows are typed `<T>`; columns declare a key, header, and optional cell
 * renderer. Built on Hanzo GUI Stacks (shorthand style props per the v5 config)
 * so it adapts across platforms. Loading and empty states are first-class:
 * loading paints SKELETON ROWS in the real column layout (an honest "loading",
 * never a spinner void); numeric columns opt into right-aligned Geist Mono
 * tabular figures so amounts/counts/IDs read as precise, column-aligned data.
 */
import type { ReactNode } from 'react'
import { Text, XStack, YStack } from '@hanzo/gui'

export type Column<T> = {
  key: string
  header: string
  /** Cell renderer; defaults to `String(row[key])`. */
  render?: (row: T) => ReactNode
  /** Fixed width (px) for the column; otherwise flexes. */
  width?: number
  /** Horizontal alignment — `right` for numeric/amount columns. */
  align?: 'left' | 'right'
  /** Typeset the default cell + header as Geist Mono tabular (counts, amounts, IDs). */
  mono?: boolean
}

/** Skeleton rows in the real column layout — an honest "loading", never a void. */
function SkeletonRows<T>({ columns, count = 6 }: { columns: Column<T>[]; count?: number }) {
  return (
    <YStack>
      {Array.from({ length: count }).map((_, r) => (
        <XStack key={r} py="$2.5" px="$3" gap="$3" borderTopWidth={1} borderColor="$borderColor" items="center">
          {columns.map((c, i) => (
            <YStack key={c.key} width={c.width} flex={c.width ? undefined : 1} minW={c.width ? undefined : FLEX_MIN_COL_W} items={c.align === 'right' ? 'flex-end' : 'flex-start'}>
              <div
                className="hz-skeleton"
                style={{ height: 12, borderRadius: 6, width: `${[62, 40, 54, 34, 48][(i + r) % 5]}%` }}
                aria-hidden
              />
            </YStack>
          ))}
        </XStack>
      ))}
    </YStack>
  )
}

export function DataTable<T>({
  columns,
  rows,
  loading,
  empty = 'Nothing here yet.',
  rowKey,
  onRowPress,
  isRowExpanded,
  renderExpanded,
}: {
  columns: Column<T>[]
  rows: T[]
  loading?: boolean
  empty?: string
  rowKey: (row: T) => string
  onRowPress?: (row: T) => void
  /** When set + true for a row, its `renderExpanded` panel is shown below it. */
  isRowExpanded?: (row: T) => boolean
  /** Full-width detail panel rendered under an expanded row (master-detail accordion). */
  renderExpanded?: (row: T) => ReactNode
}) {
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
          {/* Header — quiet, uppercase-free, Medium. A hairline under it separates
              the head from the body without a heavy fill. */}
          <XStack bg="$color1" py="$2.5" px="$3" gap="$3" borderBottomWidth={1} borderColor="$borderColor">
            {columns.map((c) => (
              <Text
                key={c.key}
                width={c.width}
                flex={c.width ? undefined : 1}
                minW={c.width ? undefined : FLEX_MIN_COL_W}
                fontSize="$1"
                fontWeight="500"
                color="$color10"
                text={c.align === 'right' ? 'right' : 'left'}
                className={c.mono ? 'hz-tnum' : undefined}
              >
                {c.header}
              </Text>
            ))}
          </XStack>

          {loading ? (
            <SkeletonRows columns={columns} />
          ) : rows.length > 0 ? (
            <YStack>
              {rows.map((row) => {
                const expanded = (isRowExpanded?.(row) ?? false) && !!renderExpanded
                return (
                <YStack key={rowKey(row)}>
                <XStack
                  className="hz-row"
                  py="$2.5"
                  px="$3"
                  gap="$3"
                  borderTopWidth={1}
                  borderColor="$borderColor"
                  items="center"
                  bg={expanded ? '$color2' : undefined}
                  hoverStyle={onRowPress ? { bg: '$color2' } : undefined}
                  cursor={onRowPress ? 'pointer' : undefined}
                  onPress={onRowPress ? () => onRowPress(row) : undefined}
                >
                  {columns.map((c) => {
                    // A cell value is either a column's rendered node or the raw
                    // `String(row[key])`. Whenever it resolves to a PRIMITIVE
                    // (string|number) — the default cell OR a `render()` that returns
                    // `String(count)` / `ttl` / `priority` — it is wrapped in the ONE
                    // styled Text below, so the primitive can never emit a bare text
                    // node (illegal under a native View → RN red-box + console spam)
                    // and always picks up the numeric mono/align styling. Element
                    // renders (Text/badges/cells) pass through untouched.
                    const cell = c.render ? c.render(row) : String((row as Record<string, unknown>)[c.key] ?? '')
                    return (
                      <YStack
                        key={c.key}
                        width={c.width}
                        flex={c.width ? undefined : 1}
                        minW={c.width ? undefined : FLEX_MIN_COL_W}
                        justify="center"
                        items={c.align === 'right' ? 'flex-end' : 'flex-start'}
                      >
                        {typeof cell === 'string' || typeof cell === 'number' ? (
                          <Text
                            fontSize="$3"
                            numberOfLines={1}
                            color="$color12"
                            text={c.align === 'right' ? 'right' : 'left'}
                            className={c.mono ? 'hz-mono' : undefined}
                          >
                            {cell}
                          </Text>
                        ) : (
                          cell
                        )}
                      </YStack>
                    )
                  })}
                </XStack>
                {expanded && renderExpanded ? (
                  <YStack borderTopWidth={1} borderColor="$borderColor" bg="$color1">
                    {renderExpanded(row)}
                  </YStack>
                ) : null}
                </YStack>
                )
              })}
            </YStack>
          ) : null}
        </YStack>
      </YStack>

      {/* Empty message lives OUTSIDE the horizontal (min-width) scroll area so it
          centers + wraps within the VISIBLE width — on a phone the min-width table
          scrolls, but "Nothing here yet." must never be clipped off the right edge. */}
      {!loading && rows.length === 0 ? (
        <YStack py="$8" px="$4" items="center" gap="$1" borderTopWidth={1} borderColor="$borderColor">
          <Text color="$color10" fontSize="$3" text="center">
            {empty}
          </Text>
        </YStack>
      ) : null}
    </YStack>
  )
}

/** Min width for a flex (no explicit `width`) column, so the table has a natural
 *  size to scroll to on mobile instead of squishing/clipping its cells. */
const FLEX_MIN_COL_W = 120
