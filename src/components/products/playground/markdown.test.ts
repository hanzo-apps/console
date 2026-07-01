import { describe, it, expect } from 'vitest'

import { parseBlocks, parseInline } from './markdown'

describe('parseBlocks', () => {
  it('parses a fenced code block with a language', () => {
    const blocks = parseBlocks('before\n```ts\nconst a = 1\n```\nafter')
    expect(blocks).toEqual([
      { type: 'para', text: 'before' },
      { type: 'code', lang: 'ts', text: 'const a = 1' },
      { type: 'para', text: 'after' },
    ])
  })

  it('renders an unterminated (still streaming) fence as code to the end', () => {
    const blocks = parseBlocks('```py\nprint(1)\nprint(2)')
    expect(blocks).toEqual([{ type: 'code', lang: 'py', text: 'print(1)\nprint(2)' }])
  })

  it('does NOT mistake `*` inside a code fence for italic', () => {
    const blocks = parseBlocks('```\na * b * c\n```')
    expect(blocks[0]).toEqual({ type: 'code', lang: '', text: 'a * b * c' })
  })

  it('parses headings, bullet + ordered lists, quotes and hr', () => {
    const blocks = parseBlocks('# Title\n\n- one\n- two\n\n1. first\n2. second\n\n> quoted\n\n---')
    expect(blocks).toEqual([
      { type: 'heading', level: 1, text: 'Title' },
      { type: 'list', ordered: false, items: ['one', 'two'] },
      { type: 'list', ordered: true, items: ['first', 'second'] },
      { type: 'quote', text: 'quoted' },
      { type: 'hr' },
    ])
  })

  it('groups consecutive plain lines into one paragraph', () => {
    expect(parseBlocks('line a\nline b')).toEqual([{ type: 'para', text: 'line a\nline b' }])
  })
})

describe('parseInline', () => {
  it('keeps plain text as a single run', () => {
    expect(parseInline('just text')).toEqual([{ t: 'text', v: 'just text' }])
  })

  it('splits inline code, bold and italic', () => {
    expect(parseInline('a `code` b **bold** c *it* d')).toEqual([
      { t: 'text', v: 'a ' },
      { t: 'code', v: 'code' },
      { t: 'text', v: ' b ' },
      { t: 'bold', v: 'bold' },
      { t: 'text', v: ' c ' },
      { t: 'italic', v: 'it' },
      { t: 'text', v: ' d' },
    ])
  })

  it('reads ** as bold, not two italics', () => {
    expect(parseInline('**x**')).toEqual([{ t: 'bold', v: 'x' }])
  })

  it('parses a link into text + href', () => {
    expect(parseInline('see [docs](https://hanzo.ai)')).toEqual([
      { t: 'text', v: 'see ' },
      { t: 'link', v: 'docs', href: 'https://hanzo.ai' },
    ])
  })
})
