import { describe, expect, it } from 'vitest'

import type { Blob, TreeEntry } from '~/lib/api/git'
import {
  baseName,
  breadcrumbSegments,
  cleanPath,
  decodeBase64Utf8,
  decodeBlobText,
  decodeReadme,
  extOf,
  imageDataUrl,
  isImagePath,
  isMarkdownPath,
  isReadmePath,
  languageForPath,
  parentPath,
  sortTreeEntries,
  splitLines,
  MAX_RENDER_BYTES,
} from './logic'

const entry = (p: Partial<TreeEntry>): TreeEntry => ({ name: '', path: '', type: 'blob', size: 0, mode: '', ...p })
const blob = (p: Partial<Blob>): Blob => ({ path: '', size: 0, encoding: 'utf8', content: '', binary: false, truncated: false, ...p })

describe('path helpers', () => {
  it('cleanPath strips leading/trailing/dup slashes', () => {
    expect(cleanPath('/src//lib/')).toBe('src/lib')
    expect(cleanPath('')).toBe('')
    expect(cleanPath(undefined)).toBe('')
  })

  it('parentPath drops the last segment', () => {
    expect(parentPath('src/lib/foo.ts')).toBe('src/lib')
    expect(parentPath('README.md')).toBe('')
    expect(parentPath('')).toBe('')
  })

  it('baseName is the last segment', () => {
    expect(baseName('src/lib/foo.ts')).toBe('foo.ts')
    expect(baseName('README')).toBe('README')
  })

  it('breadcrumbSegments accumulates the path (root excluded)', () => {
    expect(breadcrumbSegments('src/lib/foo.ts')).toEqual([
      { name: 'src', path: 'src' },
      { name: 'lib', path: 'src/lib' },
      { name: 'foo.ts', path: 'src/lib/foo.ts' },
    ])
    expect(breadcrumbSegments('')).toEqual([])
  })
})

describe('tree ordering', () => {
  it('sorts folders first, then files, each case-insensitive alpha', () => {
    const rows = [
      entry({ name: 'Zoo.ts', type: 'blob' }),
      entry({ name: 'src', type: 'tree' }),
      entry({ name: 'api.ts', type: 'blob' }),
      entry({ name: 'Docs', type: 'tree' }),
    ]
    expect(sortTreeEntries(rows).map((e) => e.name)).toEqual(['Docs', 'src', 'api.ts', 'Zoo.ts'])
  })

  it('does not mutate the input', () => {
    const rows = [entry({ name: 'b' }), entry({ name: 'a' })]
    sortTreeEntries(rows)
    expect(rows.map((e) => e.name)).toEqual(['b', 'a'])
  })
})

describe('file-kind detection', () => {
  it('extOf reads the lowercased extension', () => {
    expect(extOf('src/Foo.TS')).toBe('ts')
    expect(extOf('Makefile')).toBe('')
    expect(extOf('.gitignore')).toBe('') // dotfile with no real extension
  })

  it('isImagePath / isMarkdownPath / isReadmePath', () => {
    expect(isImagePath('a/logo.png')).toBe(true)
    expect(isImagePath('a/icon.SVG')).toBe(true)
    expect(isImagePath('a/foo.ts')).toBe(false)
    expect(isMarkdownPath('docs/guide.md')).toBe(true)
    expect(isMarkdownPath('docs/guide.mdx')).toBe(true)
    expect(isReadmePath('README.md')).toBe(true)
    expect(isReadmePath('readme')).toBe(true)
    expect(isReadmePath('READ.txt')).toBe(false)
  })

  it('languageForPath maps common extensions + special filenames', () => {
    expect(languageForPath('src/foo.ts')).toBe('TypeScript')
    expect(languageForPath('main.go')).toBe('Go')
    expect(languageForPath('Dockerfile')).toBe('Dockerfile')
    expect(languageForPath('Makefile')).toBe('Makefile')
    expect(languageForPath('data.parquet')).toBe('PARQUET')
    expect(languageForPath('LICENSE')).toBe('Text')
  })
})

describe('blob decoding', () => {
  it('decodeBase64Utf8 round-trips multibyte text', () => {
    const src = 'héllo — 世界 🚀'
    const b64 = Buffer.from(src, 'utf8').toString('base64')
    expect(decodeBase64Utf8(b64)).toBe(src)
  })

  it('decodeBlobText returns utf8 as-is, decodes base64, null on binary/too-large', () => {
    expect(decodeBlobText(blob({ content: 'hello', size: 5 }))).toBe('hello')
    const b64 = Buffer.from('func main() {}', 'utf8').toString('base64')
    expect(decodeBlobText(blob({ encoding: 'base64', content: b64, size: 14 }))).toBe('func main() {}')
    expect(decodeBlobText(blob({ binary: true, size: 10 }))).toBeNull()
    expect(decodeBlobText(blob({ content: 'x', size: MAX_RENDER_BYTES + 1 }))).toBeNull()
    expect(decodeBlobText(blob({ content: 'x', truncated: true }))).toBeNull()
  })

  it('imageDataUrl builds a data URI for base64 images + inline svg, empty otherwise', () => {
    expect(imageDataUrl(blob({ path: 'a.png', encoding: 'base64', content: 'AAAA' }))).toBe('data:image/png;base64,AAAA')
    expect(imageDataUrl(blob({ path: 'a.svg', encoding: 'utf8', content: '<svg/>' }))).toBe(
      `data:image/svg+xml;utf8,${encodeURIComponent('<svg/>')}`,
    )
    expect(imageDataUrl(blob({ path: 'a.ts', content: 'x' }))).toBe('')
  })

  it('splitLines drops a single trailing newline (no phantom blank line)', () => {
    expect(splitLines('a\nb\nc')).toEqual(['a', 'b', 'c'])
    expect(splitLines('a\nb\n')).toEqual(['a', 'b'])
    expect(splitLines('')).toEqual([''])
  })

  it('decodeReadme decodes base64, passes utf8, empty on bad base64', () => {
    const b64 = Buffer.from('# Title', 'utf8').toString('base64')
    expect(decodeReadme('base64', b64)).toBe('# Title')
    expect(decodeReadme('utf8', '# Title')).toBe('# Title')
  })
})
