'use client'

/**
 * Menu — the ONE anchored menu the console's two identity controls wear.
 *
 * The rail asks two questions at its two ends: WHERE you are (organization and
 * project, top-left) and WHO you are (account, bottom-left). They are peers, and
 * they must read as peers. They did not: the org control was a @hanzo/gui popover
 * with a 20px rounded-square mark, a two-letter monogram and a chevron, while the
 * account control was `@hanzo/iam`'s `UserMenu` — a second rendering system inside
 * one rail, drawing raw DOM through an injected global `hz-iam-*` stylesheet into
 * its own portal, with a 28px CIRCLE, a one-letter initial and no chevron. Two
 * component systems, two marks, two type scales, two sets of a11y roles, for one
 * shape. This is that shape once: the trigger, the sheet, and the rows beneath it.
 *
 * The MARK is `OrgMark` for both, because a person and an organization wear the
 * same thing — an uploaded image when there is one, their own initials when there
 * is not. One component means the two can no longer disagree about which.
 *
 * `children` receives `close`, so a row can dismiss the menu before it navigates
 * without every call site keeping its own copy of the open state.
 */
import { useCallback, useState, type ReactNode } from 'react'
import { Button, Popover, Text, XStack } from '@hanzo/gui'
import { ChevronsUpDown } from '@hanzogui/lucide-icons-2'
import { OrgMark, type Org } from '@hanzo/ui/product'

import { Z } from '~/lib/z'
import { paper } from './paper'

/** The mark both controls wear. One number, so they cannot drift. */
export const MARK = 28

export function Menu({
  mark,
  label,
  aria,
  testId,
  up,
  onOpen,
  children,
}: {
  /** Who or what this names — an org, or a person as `{ name, logo: avatar }`. */
  mark: Org
  /** The one line in the trigger. Never empty: a nameless control reads as a bug. */
  label: string
  /** The accessible name (says what the control DOES, which the label alone cannot). */
  aria: string
  testId: string
  /** Open UPWARD — for the control at the FOOT of the rail, where a downward sheet
   *  would fall off the bottom of the viewport. */
  up?: boolean
  /** Fired the first time the sheet opens — for a list that is fetched on demand. */
  onOpen?: () => void
  children: (close: () => void) => ReactNode
}) {
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const change = useCallback(
    (next: boolean) => {
      setOpen(next)
      if (next) onOpen?.()
    },
    [onOpen],
  )
  return (
    // `up` is a PREFERENCE, not a promise: `allowFlip`/`stayInFrame` let the sheet
    // turn over and slide back into view when the side it wants has no room. The
    // account control is at the foot of the desktop rail (so: upward) and near the
    // TOP of the phone's account sheet, where upward is 365px off the screen.
    <Popover
      open={open}
      onOpenChange={change}
      placement={up ? 'top-start' : 'bottom-start'}
      allowFlip
      stayInFrame
    >
      <Popover.Trigger asChild>
        <Button
          size="$3"
          height={44}
          chromeless
          justify="flex-start"
          px="$2"
          data-testid={testId}
          iconAfter={<ChevronsUpDown size={13} opacity={0.6} />}
          aria-label={aria}
        >
          <XStack items="center" gap="$2" flex={1} minW={0}>
            <OrgMark org={mark} size={MARK} />
            <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1} flex={1}>
              {label}
            </Text>
          </XStack>
        </Button>
      </Popover.Trigger>

      {/* `Z.popover` — the ladder's layer for a popover anchored inside a modal.
          On a phone this menu opens from inside the account SHEET, which sits at
          `Z.modal`; without a layer of its own it was measurable and unclickable. */}
      <Popover.Content {...paper} role="menu" p="$2" width={280} style={{ zIndex: Z.popover }}>
        {children(close)}
      </Popover.Content>
    </Popover>
  )
}

/** A quiet heading over a group of rows — "Organization", "Project", "Theme". */
export function MenuLabel({ children }: { children: ReactNode }) {
  return (
    <Text px="$2" py="$1" fontSize="$1" color="$color10" fontWeight="500">
      {children}
    </Text>
  )
}

/** The hairline between two groups of rows. */
export function MenuRule() {
  return <XStack height={1} bg="$borderColor" my="$1" />
}
