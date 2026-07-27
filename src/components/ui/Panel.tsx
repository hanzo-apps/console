'use client'

/**
 * `Panel` + `Row` — the settings surface: a stack of rounded panels, each panel a
 * group of rows, each row label + one-line description on the LEFT and its control
 * on the RIGHT.
 *
 * This was the one primitive the console genuinely did not have. There is a `paper`
 * for floating overlays, a `DataTable` for lists, `Filters`, `PageHeader`,
 * `EmptyState` — but every settings-shaped surface hand-rolled its own `Card` +
 * `XStack justify="space-between"`, so the same shape carried a different padding,
 * a different divider and a different label weight on each screen.
 *
 * Every value here is a token, never a literal: radius `$5` (12px, the panel step),
 * `$borderColor` hairline, `$color1` resting surface over the true-black canvas.
 * The row's min-height and padding sit on the 4px ramp. Nothing is decorative —
 * one hover fill, one focus ring, one hairline between rows.
 *
 * A row is only interactive when it is given `onPress`; a row that merely displays
 * a value stays inert (no hover, no pointer, not in the tab order), because a
 * surface that looks clickable and does nothing is the defect this replaces.
 */
import type { ReactNode } from 'react'
import { Text, XStack, YStack } from '@hanzo/gui'

import type { IconLike } from '~/components/ui/color'

/** A rounded panel: hairline, resting surface, optional quiet header. Rows inside
 *  are hairline-separated by the row itself, so a panel is just the container. */
export function Panel({
  title,
  description,
  icon: Icon,
  actions,
  children,
}: {
  /** Quiet section header. Sentence case — never shouted. */
  title?: string
  /** One line under the title, explaining what the group is for. */
  description?: string
  icon?: IconLike
  /** Right-aligned header controls (a button, a toggle). */
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <YStack rounded="$5" borderWidth={1} borderColor="$borderColor" bg="$color1" overflow="hidden">
      {title ? (
        <XStack items="center" gap="$2" px="$4" pt="$3" pb="$2">
          {Icon ? <Icon size={15} color="$color10" /> : null}
          <YStack flex={1} minW={0} gap="$0.5">
            <Text fontSize="$3" fontWeight="600" color="$color12">
              {title}
            </Text>
            {description ? (
              <Text fontSize="$2" color="$color10">
                {description}
              </Text>
            ) : null}
          </YStack>
          {actions}
        </XStack>
      ) : null}
      <YStack>{children}</YStack>
    </YStack>
  )
}

/** One row: label + one-line description left, control right.
 *
 *  `control` is anything — a switch, a select, a button, or a read-only value.
 *  Pass a plain string as `value` for the read-only case and it renders on the
 *  design scale with an honest em dash when absent, so a missing fact never reads
 *  as an empty cell. */
export function Row({
  label,
  description,
  control,
  value,
  mono,
  onPress,
  first,
}: {
  label: string
  description?: string
  control?: ReactNode
  /** Read-only right-hand value. An empty/absent value renders an em dash. */
  value?: string | null
  /** Typeset the value as data — Geist Mono, tabular figures. For ids, tags,
   *  endpoints, counts and prices. */
  mono?: boolean
  onPress?: () => void
  /** Suppresses the top hairline — set on the first row of a headerless panel. */
  first?: boolean
}) {
  const interactive = !!onPress
  const text = value === undefined || value === null || value === '' ? '—' : value
  return (
    <XStack
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      onPress={onPress}
      cursor={interactive ? 'pointer' : undefined}
      hoverStyle={interactive ? { bg: '$color2' } : undefined}
      focusStyle={interactive ? { bg: '$color2' } : undefined}
      items="center"
      gap="$3"
      px="$4"
      py="$3"
      minH={52}
      borderTopWidth={first ? 0 : 1}
      borderColor="$borderColor"
      flexWrap="wrap"
    >
      <YStack flex={1} minW={180} gap="$0.5">
        <Text fontSize="$3" color="$color12">
          {label}
        </Text>
        {description ? (
          <Text fontSize="$2" color="$color10">
            {description}
          </Text>
        ) : null}
      </YStack>
      {control ?? (
        <Text
          className={mono ? 'hz-mono' : undefined}
          fontSize="$3"
          color={text === '—' ? '$color9' : '$color11'}
          numberOfLines={1}
        >
          {text}
        </Text>
      )}
    </XStack>
  )
}
