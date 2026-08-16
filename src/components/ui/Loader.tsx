'use client'

/**
 * The brand loader — the resolved brand's mark, breathing.
 *
 * The mark itself is `BrandMark` from @hanzo/ui, which resolves geometry from
 * the fleet registry. This file used to carry its own second copy of that
 * resolution, next to the one in BrandLogo: same registry, same fields, two
 * implementations, and only this one knew about motion.
 */
import { Text, YStack } from '@hanzo/gui'

import { BrandMark } from './BrandLogo'

export { BrandMark }

/** Full-screen centered brand loader with an optional label. */
export function Loader({ label, size = 48 }: { label?: string; size?: number }) {
  return (
    <YStack flex={1} minH="100vh" items="center" justify="center" gap="$3">
      {/* The breathe is `.hz-breathe` in globals.css. It used to be a <style> child
          here defining its own `hz-pulse`, which replaced the globals.css keyframe
          of that name for the whole document — so any Loader on screen stopped the
          `.hz-rail-dot` live indicator from scaling. */}
      <div className="hz-breathe">
        <BrandMark size={size} animated={false} />
      </div>
      {label ? (
        <Text fontSize="$3" color="$color11">
          {label}
        </Text>
      ) : null}
    </YStack>
  )
}
