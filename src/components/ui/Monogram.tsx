'use client'

/**
 * `Monogram` — marks a subtree as a GRAPHIC rather than app text.
 *
 * An avatar's initials, an org mark, a brand tile: the glyph inside scales with
 * its circle, because a fixed 11px monogram in a 40px tile reads broken. So these
 * legitimately paint text sizes that are not on the app type scale, and the
 * design gate (e2e/design-invariants.spec.ts) skips them.
 *
 * It has to be a real DOM element. react-native-web drops unknown props, so a
 * `data-monogram` written straight onto a Gui `<XStack>` never reaches the
 * document — the marker looks applied in the source and is absent in the page,
 * which is worse than not having one. `display: contents` means the wrapper adds
 * the marker and nothing else: no box, no layout effect, the children keep their
 * parent's flex context.
 *
 * One marker, one meaning, one place to find every exemption.
 */
import type { ReactNode } from 'react'

export function Monogram({ children }: { children: ReactNode }) {
  return (
    <span data-monogram style={{ display: 'contents' }}>
      {children}
    </span>
  )
}
