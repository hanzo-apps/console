'use client'

/**
 * `Panel` + `Row` — the console's rounded panel, and the settings row inside it.
 *
 * A panel is a rounded surface with a quiet header and a body. That was already
 * TWO things: `ui/Metric.tsx` had a `Panel` for chart/content bodies (13
 * consumers), and every settings-shaped surface hand-rolled its own `Card` +
 * `XStack justify="space-between"` — so one concept carried a different padding,
 * a different divider and a different label weight on each screen. This is that
 * concept, once.
 *
 * A body is one of two shapes, and the panel is told which:
 *   - CONTENT (the default) — a chart, a form, prose. The panel pads it.
 *   - ROWS (`rows`) — a list of `Row`s. Rows own their own padding and the
 *     hairline between them, so the panel must not add its own.
 * The flag names the CONTENT SHAPE, not a style, which is why it is a flag and
 * not a second component.
 *
 * Every value is a token: radius `$5` (12px, the panel step), `$borderColor`
 * hairline, `$color1` resting surface over the true-black canvas. Nothing is
 * decorative — one hover fill, one focus ring, one hairline.
 */
import type { ReactNode } from 'react'
import { Text, XStack, YStack } from '@hanzo/gui'

import type { IconLike } from '~/components/ui/color'

export function Panel({
  title,
  description,
  icon: Icon,
  actions,
  rows,
  minW = 280,
  grow = true,
  children,
}: {
  /** Quiet section header. Sentence case — never shouted. */
  title?: string
  /** One line under the title, explaining what the group is for. */
  description?: string
  icon?: IconLike
  /** Right-aligned header controls (a button, a range toggle, a legend). */
  actions?: ReactNode
  /** The body is a list of `Row`s, which pad and separate themselves. */
  rows?: boolean
  minW?: number
  grow?: boolean
  children: ReactNode
}) {
  return (
    <YStack
      rounded="$5"
      borderWidth={1}
      borderColor="$borderColor"
      bg="$color1"
      overflow="hidden"
      flex={grow ? 1 : undefined}
      width={grow ? undefined : '100%'}
      // The minimum is what makes panels sit two-up in a wrapping row on a wide
      // screen — but a PIXEL minimum larger than its container clips the panel off
      // the right edge of a phone with nothing to scroll it (measured: a 340px
      // minimum inside a 366px pane painted to x=432 at 390 wide). `min()` says the
      // real intent — this wide, but never wider than the space there is — with no
      // breakpoint to get backwards. It rides `style` because it is a CSS function,
      // not a token.
      style={{ minWidth: `min(${minW}px, 100%)` }}
    >
      {title ? (
        <XStack items="center" gap="$2" px="$4" pt="$3" pb={rows ? '$2' : '$1'}>
          {Icon ? <Icon size={15} color="$color10" /> : null}
          <YStack flex={1} minW={0} gap="$0.5">
            <Text fontSize="$4" fontWeight="600" color="$color12">
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
      {rows ? <YStack>{children}</YStack> : <YStack px="$4" pt={title ? '$2' : '$4'} pb="$4" gap="$3">{children}</YStack>}
    </YStack>
  )
}

/** One settings row: label + one-line description left, control right.
 *
 *  `control` is anything — a switch, a select, a button. Pass `value` instead for
 *  the read-only case and it renders on the design scale with an honest em dash
 *  when absent, so a missing fact never reads as an empty cell.
 *
 *  A row is interactive ONLY when given `onPress`; otherwise it stays inert — no
 *  hover, no pointer, not in the tab order — because a row that looks clickable
 *  and does nothing is the defect this replaces. */
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
  /** Suppresses the top hairline — set on the first row of a panel. */
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
      <YStack flex={1} minW={0} gap="$0.5">
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
          className={mono ? 'mono' : undefined}
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
