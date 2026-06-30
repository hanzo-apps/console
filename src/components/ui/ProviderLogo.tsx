'use client'

/**
 * ProviderLogo — a small, monochrome provider/model avatar resolved from a
 * provider NAME alone (no external logo URLs, no network). Self-contained and
 * prop-driven so it lifts cleanly into `@hanzo/ui` for hanzo.ai / @hanzo/dev /
 * the desktop app.
 *
 * Resolution order:
 *   1. First-party (Hanzo/Zen) → a filled foreground chip with the Sparkles
 *      brand mark, so our own models read distinctly.
 *   2. A known provider → its mapped @hanzogui/lucide-icons-2 glyph.
 *   3. Otherwise → a stable initials chip (1–2 letters from the name).
 *
 * Honest by construction: we never claim an official brand logo we don't ship —
 * unknown providers get clean initials, not a guessed icon. Icon colors are
 * @hanzo/gui theme tokens (`$color1`/`$color11`) so the mark themes with the shell.
 */
import { Text, XStack } from '@hanzo/gui'
import { Sparkles, Boxes, Server, Globe, Cpu } from '@hanzogui/lucide-icons-2'

type IconCmp = typeof Sparkles

/** Curated, extendable provider→glyph map (lowercased keys). Brand-neutral avatars. */
const KNOWN: Record<string, IconCmp> = {
  openrouter: Globe,
  nvidia: Cpu,
}

const isFirstParty = (provider: string): boolean => {
  const p = provider.trim().toLowerCase()
  return p === 'hanzo' || p === 'zen'
}

/** 1–2 uppercase initials from a provider name: words→first letters, else first 2 chars. */
export function providerInitials(provider: string): string {
  const name = provider.trim()
  if (!name) return '•'
  const words = name.split(/[\s/_-]+/).filter(Boolean)
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
  return name.slice(0, 2).toUpperCase()
}

export function ProviderLogo({ provider, size = 24 }: { provider: string; size?: number }) {
  const radius = Math.round(size * 0.28)
  const iconSize = Math.round(size * 0.56)

  // First-party (Zen/Hanzo) — a filled foreground chip that stands out as "ours".
  if (isFirstParty(provider)) {
    return (
      <XStack width={size} height={size} items="center" justify="center" rounded={radius} bg="$color12">
        <Sparkles size={iconSize} color="$color1" />
      </XStack>
    )
  }

  // A known provider with a curated, brand-neutral glyph.
  const Known = KNOWN[provider.trim().toLowerCase()]
  if (Known) {
    return (
      <XStack
        width={size}
        height={size}
        items="center"
        justify="center"
        rounded={radius}
        bg="$color3"
        borderWidth={1}
        borderColor="$borderColor"
      >
        <Known size={iconSize} color="$color11" />
      </XStack>
    )
  }

  // Otherwise — a clean, stable initials chip (no fabricated brand logo).
  return (
    <XStack
      width={size}
      height={size}
      items="center"
      justify="center"
      rounded={radius}
      bg="$color3"
      borderWidth={1}
      borderColor="$borderColor"
    >
      <Text fontSize={Math.round(size * 0.4)} fontWeight="800" color="$color11">
        {providerInitials(provider)}
      </Text>
    </XStack>
  )
}

/** A generic fallback mark for an unspecified provider (used sparingly). */
export function GenericLogo({ size = 24 }: { size?: number }) {
  return (
    <XStack width={size} height={size} items="center" justify="center" rounded={Math.round(size * 0.28)} bg="$color3" borderWidth={1} borderColor="$borderColor">
      <Server size={Math.round(size * 0.56)} color="$color11" />
    </XStack>
  )
}

// Boxes is re-exported as the conventional "custom model" mark for callers that
// render a non-provider tile next to ProviderLogo (keeps the icon source single).
export { Boxes as CustomModelMark }
