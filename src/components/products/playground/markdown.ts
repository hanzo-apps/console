/**
 * Markdown — a tiny, dependency-free tokenizer for rendering model output.
 *
 * LLM completions are markdown: fenced code, inline code, bold/italic, headings,
 * lists, blockquotes and links. We parse the streamed text into BLOCKS (and each
 * block's inline SEGMENTS) here — pure and unit-tested — so the renderer
 * (`MarkdownView`) stays a thin map from tokens to `@hanzo/gui` elements. Parsing
 * is streaming-safe: an unterminated code fence (still arriving) renders as a code
 * block to the end rather than swallowing the rest of the document.
 */

/** One inline run within a block of text. */
export type Inline =
  | { t: 'text'; v: string }
  | { t: 'code'; v: string }
  | { t: 'bold'; v: string }
  | { t: 'italic'; v: string }
  | { t: 'link'; v: string; href: string }

/** A top-level block of the document. */
export type Block =
  | { type: 'code'; lang: string; text: string }
  | { type: 'heading'; level: number; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'quote'; text: string }
  | { type: 'hr' }
  | { type: 'para'; text: string }

const FENCE = /^\s*```(.*)$/
const CLOSE_FENCE = /^\s*```\s*$/
const HEADING = /^(#{1,6})\s+(.*)$/
const LIST = /^\s*([-*+]|\d+[.)])\s+(.*)$/
const ORDERED = /^\s*\d+[.)]\s+/
const HR = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/
const QUOTE = /^\s*>\s?(.*)$/

/** Split markdown source into ordered blocks. */
export function parseBlocks(src: string): Block[] {
  const lines = src.replace(/\r\n/g, '\n').split('\n')
  const blocks: Block[] = []
  let para: string[] = []
  const flush = (): void => {
    if (para.length) {
      blocks.push({ type: 'para', text: para.join('\n') })
      para = []
    }
  }

  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    const fence = FENCE.exec(line)
    if (fence) {
      flush()
      const body: string[] = []
      i++
      while (i < lines.length && !CLOSE_FENCE.test(lines[i])) {
        body.push(lines[i])
        i++
      }
      i++ // consume the closing fence (or step past EOF for a still-streaming block)
      blocks.push({ type: 'code', lang: fence[1].trim(), text: body.join('\n') })
      continue
    }

    if (line.trim() === '') {
      flush()
      i++
      continue
    }

    if (HR.test(line)) {
      flush()
      blocks.push({ type: 'hr' })
      i++
      continue
    }

    const heading = HEADING.exec(line)
    if (heading) {
      flush()
      blocks.push({ type: 'heading', level: heading[1].length, text: heading[2].trim() })
      i++
      continue
    }

    if (LIST.test(line)) {
      flush()
      const ordered = ORDERED.test(line)
      const items: string[] = []
      while (i < lines.length && LIST.test(lines[i])) {
        const m = LIST.exec(lines[i])
        if (m) items.push(m[2])
        i++
      }
      blocks.push({ type: 'list', ordered, items })
      continue
    }

    const quote = QUOTE.exec(line)
    if (quote) {
      flush()
      const q: string[] = []
      while (i < lines.length && QUOTE.test(lines[i])) {
        const m = QUOTE.exec(lines[i])
        q.push(m ? m[1] : '')
        i++
      }
      blocks.push({ type: 'quote', text: q.join('\n') })
      continue
    }

    para.push(line)
    i++
  }
  flush()
  return blocks
}

type Rule = { t: Exclude<Inline['t'], 'text'>; re: RegExp }

// Order matters only as a tie-break at the SAME index: code beats bold beats
// italic — so `**x**` reads bold (not two italics) and `` `a*b` `` reads code.
const RULES: Rule[] = [
  { t: 'code', re: /`([^`]+)`/ },
  { t: 'bold', re: /\*\*([^*]+)\*\*|__([^_]+)__/ },
  { t: 'italic', re: /\*([^*]+)\*|_([^_]+)_/ },
  { t: 'link', re: /\[([^\]]+)\]\(([^)\s]+)\)/ },
]

function toNode(rule: Rule, m: RegExpExecArray): Inline {
  switch (rule.t) {
    case 'code':
      return { t: 'code', v: m[1] }
    case 'bold':
      return { t: 'bold', v: m[1] ?? m[2] }
    case 'italic':
      return { t: 'italic', v: m[1] ?? m[2] }
    case 'link':
      return { t: 'link', v: m[1], href: m[2] }
  }
}

/** Split a line of text into inline runs (code / bold / italic / link / text). */
export function parseInline(text: string): Inline[] {
  const out: Inline[] = []
  let rest = text
  while (rest.length) {
    let best: { idx: number; len: number; node: Inline } | null = null
    for (const rule of RULES) {
      const m = rule.re.exec(rest)
      if (!m) continue
      if (best && m.index >= best.idx) continue
      best = { idx: m.index, len: m[0].length, node: toNode(rule, m) }
    }
    if (!best) {
      out.push({ t: 'text', v: rest })
      break
    }
    if (best.idx > 0) out.push({ t: 'text', v: rest.slice(0, best.idx) })
    out.push(best.node)
    rest = rest.slice(best.idx + best.len)
  }
  return out
}
