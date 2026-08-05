'use client'

/**
 * Shared presentational parts for the Code dashboard — the titled panel, the tier /
 * kind badges, the relative score bar, the clickable `file:line` reference, the
 * copy-reference control, the one-line snippet, the span detail view, and the
 * citation row. Built only on shared GUI primitives, so the board reads identically
 * everywhere. No data is produced here — every part renders REAL values passed in
 * (or an honest "—").
 *
 * Style props use the @hanzo/gui v5 shorthand set (bg/p/px/py/gap/rounded/items/…).
 */
import { useState, type ReactNode } from 'react'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { Check, Copy } from '@hanzogui/lucide-icons-2'

import { fmtScore, fullRef, locRef, scoreFraction, type Citation, type Span } from '~/lib/api/code'
import { RAMP } from '~/lib/theme/ramp'
import { CopyButton, asColor } from '@hanzo/ui/product'

/** A titled dashboard card — the ONE panel wrapper the board composes. */
/** Copy a `repo file:line` reference — the shared control, given the reference. */
export function CopyRef({ loc, size = 24 }: { loc: { repo?: string; file?: string; line?: number; endLine?: number }; size?: number }) {
  return <CopyButton value={fullRef(loc)} label="Copy reference" size={size} id="code-ref" />
}

export function Panel({
  title,
  action,
  children,
  flex = 1,
  minW = 260,
}: {
  title: string
  action?: ReactNode
  children: ReactNode
  flex?: number
  minW?: number
}) {
  return (
    <Card flex={flex} minW={minW} p="$4" gap="$3" borderWidth={1} borderColor="$borderColor">
      <XStack items="center" justify="space-between" gap="$2" flexWrap="wrap">
        <Text fontSize="$4" fontWeight="800" color="$color12">
          {title}
        </Text>
        {action}
      </XStack>
      {children}
    </Card>
  )
}

/** Retrieval tier is a CATEGORY, not a state — it reads off the shared categorical
 *  scale (lightness, never hue). The badge's own label names the tier. */
const TIER_STEP: Record<string, string> = {
  text: RAMP[0],
  symbol: RAMP[1],
  semantic: RAMP[2],
  hybrid: RAMP[3],
}

/** A subtle badge naming the retrieval tier that surfaced a hit. */
export function TierBadge({ tier }: { tier?: string }) {
  if (!tier) return null
  const hex = TIER_STEP[tier] ?? RAMP[5]
  return (
    <XStack items="center" gap="$1.5" px="$2" py="$0.5" rounded="$10" bg="$color3">
      <YStack width={7} height={7} rounded="$10" bg={asColor(hex)} />
      <Text fontSize="$1" color="$color11" fontWeight="600">
        {tier}
      </Text>
    </XStack>
  )
}

/** A quiet badge for a symbol kind (func/type/method/…). */
export function KindBadge({ kind }: { kind?: string }) {
  if (!kind) return null
  return (
    <Text fontSize="$1" px="$1.5" py="$0.5" rounded="$3" bg="$color3" color="$color11" fontWeight="700">
      {kind}
    </Text>
  )
}

/** The real score + a RELATIVE bar (score / set-max) — a visual rank aid over real
 *  values, never a fabricated absolute. */
export function ScoreBar({ score, max }: { score: number; max: number }) {
  const frac = scoreFraction(score, max)
  return (
    <YStack gap="$1" minW={56}>
      <Text fontSize="$2" color="$color12" className="hz-mono" text="right">
        {fmtScore(score)}
      </Text>
      <YStack height={4} rounded="$10" bg="$color4" overflow="hidden">
        <YStack height={4} rounded="$10" bg="$color9" width={`${Math.round(frac * 100)}%`} />
      </YStack>
    </YStack>
  )
}

/** A clickable `file:line` reference (monospace). Opens the row's detail on press. */
export function RefButton({ loc, onPress }: { loc: { file?: string; line?: number; endLine?: number }; onPress?: () => void }) {
  return (
    <Text
      className="hz-mono"
      fontSize="$2"
      color="$color11"
      numberOfLines={1}
      onPress={onPress}
      cursor={onPress ? 'pointer' : undefined}
      hoverStyle={onPress ? { color: '$color12' } : undefined}
    >
      {locRef(loc)}
    </Text>
  )
}

/** One-line snippet preview (monospace, truncated). */
export function SnippetLine({ text }: { text: string }) {
  if (!text) return <Text fontSize="$2" color="$color10">—</Text>
  return (
    <Text className="hz-mono" fontSize="$1" color="$color11" numberOfLines={1}>
      {text.replace(/\n+/g, ' ⏎ ').trim()}
    </Text>
  )
}

/** A label · value fact row inside the detail pane. */
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <XStack justify="space-between" gap="$3" py="$1.5" borderBottomWidth={1} borderColor="$borderColor">
      <Text fontSize="$2" color="$color10">
        {label}
      </Text>
      <Text fontSize="$2" color="$color12" fontWeight="600" numberOfLines={1} className="hz-mono">
        {value}
      </Text>
    </XStack>
  )
}

const DASH = '—'

/** The per-hit detail view (in the right-side pane): REAL facts + the full snippet. */
export function SpanDetail({ span }: { span: Span }) {
  return (
    <YStack gap="$3">
      <XStack items="center" gap="$2" flexWrap="wrap">
        <TierBadge tier={span.tier} />
        <KindBadge kind={span.kind} />
        {span.role ? <KindBadge kind={span.role} /> : null}
      </XStack>

      <YStack gap="$1">
        <Fact label="Repo" value={span.repo || DASH} />
        <Fact label="File" value={span.file} />
        <Fact label="Lines" value={span.endLine > span.line ? `${span.line}–${span.endLine}` : String(span.line)} />
        <Fact label="Symbol" value={span.symbol || DASH} />
        <Fact label="Score" value={fmtScore(span.score)} />
      </YStack>

      <YStack gap="$2" pt="$1">
        <XStack items="center" justify="space-between">
          <Text fontSize="$3" fontWeight="700" color="$color12">
            Snippet
          </Text>
          <CopyRef loc={span} />
        </XStack>
        {span.snippet ? (
          <YStack borderWidth={1} borderColor="$borderColor" rounded="$4" bg="$color1" p="$3" style={{ overflowX: 'auto' }}>
            <Text className="hz-mono" fontSize="$2" color="$color12" style={{ whiteSpace: 'pre' }}>
              {span.snippet}
            </Text>
          </YStack>
        ) : (
          <Text fontSize="$2" color="$color10">
            No snippet returned for this hit.
          </Text>
        )}
      </YStack>
    </YStack>
  )
}

/** One citation row in the Ask panel — a copyable `file:line` locator (+ repo/symbol). */
export function CitationRow({ citation, onPress }: { citation: Citation; onPress?: () => void }) {
  return (
    <XStack
      items="center"
      gap="$2"
      py="$2"
      px="$2.5"
      borderWidth={1}
      borderColor="$borderColor"
      rounded="$3"
      bg="$color1"
      minW={0}
    >
      <YStack flex={1} minW={0} gap="$0.5">
        <RefButton loc={citation} onPress={onPress} />
        {citation.repo || citation.symbol ? (
          <Text fontSize="$1" color="$color10" numberOfLines={1}>
            {[citation.repo, citation.symbol].filter(Boolean).join(' · ')}
          </Text>
        ) : null}
      </YStack>
      <CopyRef loc={citation} />
    </XStack>
  )
}
