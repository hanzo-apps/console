'use client'

/**
 * Tiny, dependency-free markdown for chat bubbles.
 *
 * console2 ships no markdown library (and adding remark/rehype would drag a heavy
 * tree into a frontend that renders a handful of inline marks), so this is the ONE
 * place a message string becomes readable rich text:
 *   - ``` fenced ``` blocks → a monospace, subtly-tinted code card (optional lang tag)
 *   - `inline code`         → a monospace chip
 *   - **bold**              → emphasized run
 *   - blank lines           → paragraph spacing; single newlines wrap naturally
 *
 * It is presentation only — it never executes or fetches anything, and unmatched
 * markup falls through as plain text. Monospace uses the same
 * `style={{ fontFamily: 'monospace' }}` idiom the rest of the console uses.
 */
import { Fragment, type ReactNode } from 'react'
import { Text, YStack } from '@hanzo/gui'

const MONO = { fontFamily: 'monospace' } as const

/** Split a paragraph into bold / inline-code / plain runs (one level, non-nested). */
function renderInline(text: string, fontSize: '$2' | '$3' = '$3'): ReactNode[] {
  // Alternating split on `code` and **bold** — capture groups keep the delimiters.
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g)
  return parts.map((part, i) => {
    if (!part) return null
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return (
        <Text
          key={i}
          fontSize={fontSize}
          color="$color12"
          bg="$color3"
          px="$1.5"
          py="$0.5"
          rounded="$2"
          selectable
          style={MONO}
        >
          {part.slice(1, -1)}
        </Text>
      )
    }
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return (
        <Text key={i} fontSize={fontSize} color="$color12" fontWeight="700">
          {part.slice(2, -2)}
        </Text>
      )
    }
    return (
      <Fragment key={i}>{part}</Fragment>
    )
  })
}

/** A fenced code block — monospace, subtly tinted, horizontally scrollable text. */
function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  return (
    <YStack
      bg="$color2"
      borderWidth={1}
      borderColor="$borderColor"
      rounded="$4"
      px="$3"
      py="$2.5"
      gap="$1"
      overflow="hidden"
    >
      {lang ? (
        <Text fontSize="$1" color="$color10" style={MONO}>
          {lang}
        </Text>
      ) : null}
      <Text fontSize="$2" color="$color12" selectable style={MONO}>
        {code}
      </Text>
    </YStack>
  )
}

type Block =
  | { kind: 'code'; code: string; lang?: string }
  | { kind: 'text'; text: string }

/** Parse the message into alternating fenced-code and text blocks. */
function parseBlocks(src: string): Block[] {
  const blocks: Block[] = []
  const fence = /```([^\n`]*)\n?([\s\S]*?)```/g
  let last = 0
  let m: RegExpExecArray | null
  while ((m = fence.exec(src)) !== null) {
    if (m.index > last) blocks.push({ kind: 'text', text: src.slice(last, m.index) })
    const lang = m[1]?.trim() || undefined
    blocks.push({ kind: 'code', code: (m[2] ?? '').replace(/\n$/, ''), lang })
    last = fence.lastIndex
  }
  if (last < src.length) blocks.push({ kind: 'text', text: src.slice(last) })
  return blocks
}

/** Render a text block as paragraphs (blank-line separated), wrapping inline marks. */
function TextBlock({ text, size }: { text: string; size: '$2' | '$3' }) {
  // Trim only the leading/trailing blank lines a fence leaves behind.
  const paras = text.replace(/^\n+/, '').replace(/\n+$/, '').split(/\n{2,}/)
  return (
    <>
      {paras.map((para, i) =>
        para === '' ? null : (
          <Text key={i} fontSize={size} color="$color12" lineHeight={size === '$3' ? 22 : 20}>
            {renderInline(para, size)}
          </Text>
        ),
      )}
    </>
  )
}

/** Render a chat message string as light markdown. */
export function Markdown({ content, size = '$3' }: { content: string; size?: '$2' | '$3' }) {
  const blocks = parseBlocks(content)
  return (
    <YStack gap="$2">
      {blocks.map((b, i) =>
        b.kind === 'code' ? (
          <CodeBlock key={i} code={b.code} lang={b.lang} />
        ) : (
          <TextBlock key={i} text={b.text} size={size} />
        ),
      )}
    </YStack>
  )
}
