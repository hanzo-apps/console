'use client'

/**
 * MenuRow — ONE selectable row for the console's popover menus.
 *
 * The context switcher (org + project) and the network switcher both list
 * "pick one of these" rows with the same anatomy: an optional leading dot or
 * icon, a label, an optional sub-label, and a check on the active one. That row
 * was written twice; this is it once, so the two switchers cannot drift apart
 * in padding, hover or type.
 *
 * `DotColor` is the tier hue used by the network switcher — monochrome by
 * default, and only the genuine states carry a hue (mainnet live green, testnet
 * caution amber). It lives here because the row is what paints it.
 */
import type { ReactNode } from 'react'
import { Text, XStack, YStack } from '@hanzo/gui'
import { Check } from '@hanzogui/lucide-icons-2'

export type DotColor = '$green10' | '$yellow10' | '$color10' | '$color9' | '$color8'

export function MenuRow({
  label,
  sub,
  dot,
  icon,
  active,
  onPress,
}: {
  label: string
  sub?: string
  dot?: DotColor
  icon?: ReactNode
  /**
   * Whether this row is the chosen one. Its PRESENCE also decides the row's
   * semantics: a row that can be current is one of a set exactly one of which
   * holds (`radio`, inside the caller's `radiogroup`), while a row without the
   * notion is an action (`menuitem`). So "Acme Industrial" is a radio and "New
   * project" is not, without either call site having to say so twice.
   *
   * `radio` rather than the more obvious `option` because @hanzo/gui's `role`
   * union is React Native's accessibility-role set: it admits `option` but NOT
   * `listbox`, so an `option` here could never be given the parent ARIA
   * requires. `radiogroup`/`radio` is the single-select pair gui does carry
   * whole, and it says the same thing.
   */
  active?: boolean
  onPress: () => void
}) {
  const selectable = active !== undefined
  return (
    <XStack
      onPress={onPress}
      role={selectable ? 'radio' : 'menuitem'}
      aria-checked={selectable ? !!active : undefined}
      cursor="pointer"
      items="center"
      gap="$2"
      px="$2"
      py="$2"
      rounded="$3"
      hoverStyle={{ bg: '$color4' }}
    >
      {dot ? <YStack width={8} height={8} rounded="$10" bg={dot} /> : icon}
      <YStack flex={1}>
        <Text fontSize="$2" color="$color12" numberOfLines={1}>
          {label}
        </Text>
        {sub ? (
          <Text fontSize="$1" color="$color10">
            {sub}
          </Text>
        ) : null}
      </YStack>
      {active ? <Check size={14} /> : null}
    </XStack>
  )
}
