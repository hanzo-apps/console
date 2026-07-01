'use client'

/**
 * MarkdownView — render a model completion as real markdown.
 *
 * A thin map from the pure `markdown.ts` tokens to `@hanzo/gui` elements: fenced
 * code blocks (monospace, horizontally scrollable, copy button), inline
 * code/bold/italic/links, headings, lists, blockquotes and rules. Streaming-safe
 * (an open code fence renders as code), so the response never shows raw markup or
 * doubled text — just the formatted answer as it arrives.
 */
import { useState } from 'react'
import { Button, Card, ScrollView, Text, XStack, YStack } from '@hanzo/gui'
import { Copy, Check } from '@hanzogui/lucide-icons-2'

import { parseBlocks, parseInline, type Inline } from './markdown'

type Sz = '$2' | '$3' | '$4' | '$5' | '$6' | '$7'
const HEADING_SIZE: Record<number, Sz> = { 1: '$7', 2: '$6', 3: '$5', 4: '$4', 5: '$3', 6: '$3' }

function copyText(text: string): void {
  if (typeof navigator !== 'undefined' && navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {})
}

function openHref(href: string): void {
  if (typeof window !== 'undefined') window.open(href, '_blank', 'noopener')
}

/** Render one block's inline runs as a single wrapping Text (newlines preserved). */
function Inlines({ runs, size = '$3', color = '$color12', weight }: { runs: Inline[]; size?: Sz; color?: '$color11' | '$color12'; weight?: '700' | '800' }) {
  return (
    <Text fontSize={size} color={color} fontWeight={weight} style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
      {runs.map((r, i) => {
        if (r.t === 'code')
          return (
            <Text key={i} fontSize={size} color="$color12" bg="$color3" px="$1" rounded="$2" style={{ fontFamily: 'monospace' }}>
              {r.v}
            </Text>
          )
        if (r.t === 'bold')
          return (
            <Text key={i} fontSize={size} color={color} fontWeight="800">
              {r.v}
            </Text>
          )
        if (r.t === 'italic')
          return (
            <Text key={i} fontSize={size} color={color} fontStyle="italic">
              {r.v}
            </Text>
          )
        if (r.t === 'link')
          return (
            <Text key={i} fontSize={size} color="$color12" onPress={() => openHref(r.href)} style={{ textDecorationLine: 'underline', cursor: 'pointer' }}>
              {r.v}
            </Text>
          )
        return (
          <Text key={i} fontSize={size} color={color}>
            {r.v}
          </Text>
        )
      })}
    </Text>
  )
}

function CodeBlock({ lang, text }: { lang: string; text: string }) {
  const [done, setDone] = useState(false)
  const copy = (): void => {
    copyText(text)
    setDone(true)
    setTimeout(() => setDone(false), 1200)
  }
  return (
    <Card bg="$color2" borderWidth={1} borderColor="$borderColor" p="$0" overflow="hidden">
      <XStack items="center" justify="space-between" px="$3" py="$1.5" borderBottomWidth={1} borderColor="$borderColor" bg="$color3">
        <Text fontSize="$1" color="$color10">
          {lang || 'code'}
        </Text>
        <Button size="$1" chromeless icon={done ? <Check size={13} color="$green10" /> : <Copy size={13} />} onPress={copy} aria-label="Copy code" />
      </XStack>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <YStack p="$3">
          <Text fontSize="$2" color="$color12" style={{ whiteSpace: 'pre', fontFamily: 'monospace' }}>
            {text}
          </Text>
        </YStack>
      </ScrollView>
    </Card>
  )
}

export function MarkdownView({ text }: { text: string }) {
  const blocks = parseBlocks(text)
  return (
    <YStack gap="$2.5">
      {blocks.map((b, i) => {
        if (b.type === 'code') return <CodeBlock key={i} lang={b.lang} text={b.text} />
        if (b.type === 'heading')
          return <Inlines key={i} runs={parseInline(b.text)} size={HEADING_SIZE[b.level] ?? '$4'} weight="800" />
        if (b.type === 'hr') return <YStack key={i} height={1} bg="$borderColor" my="$1" />
        if (b.type === 'quote')
          return (
            <YStack key={i} borderLeftWidth={3} borderColor="$borderColor" pl="$3" py="$0.5">
              <Inlines runs={parseInline(b.text)} color="$color11" />
            </YStack>
          )
        if (b.type === 'list')
          return (
            <YStack key={i} gap="$1.5" pl="$1">
              {b.items.map((item, j) => (
                <XStack key={j} gap="$2" items="flex-start">
                  <Text fontSize="$3" color="$color10" minW={b.ordered ? 18 : 10}>
                    {b.ordered ? `${j + 1}.` : '•'}
                  </Text>
                  <YStack flex={1}>
                    <Inlines runs={parseInline(item)} />
                  </YStack>
                </XStack>
              ))}
            </YStack>
          )
        return <Inlines key={i} runs={parseInline(b.text)} />
      })}
    </YStack>
  )
}
