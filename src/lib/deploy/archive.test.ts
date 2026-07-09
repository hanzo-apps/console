import { describe, it, expect } from 'vitest'

import { buildTar, tarHeader, stripCommonRoot, type ArtifactFile } from './archive'

const enc = new TextEncoder()
const dec = new TextDecoder()

/** Read a NUL/space-trimmed ASCII field out of a tar header. */
function field(h: Uint8Array, off: number, len: number): string {
  return dec.decode(h.slice(off, off + len)).replace(/\0.*$/, '').trim()
}
/** Recompute the ustar header checksum (chksum field taken as spaces). */
function checksum(h: Uint8Array): number {
  const copy = h.slice()
  for (let i = 148; i < 156; i++) copy[i] = 0x20
  let s = 0
  for (let i = 0; i < 512; i++) s += copy[i]
  return s
}

describe('tarHeader', () => {
  it('writes name, ustar magic, regular-file typeflag, octal size + a VALID checksum', () => {
    const h = tarHeader('index.html', 6, 0)
    expect(h.length).toBe(512)
    expect(field(h, 0, 100)).toBe('index.html')
    expect(field(h, 257, 6)).toBe('ustar')
    expect(h[156]).toBe(0x30) // '0' = regular file
    expect(parseInt(field(h, 124, 12), 8)).toBe(6) // size, octal
    expect(parseInt(field(h, 148, 8), 8)).toBe(checksum(h)) // stored checksum is correct
  })

  it('splits a long path into the ustar prefix field', () => {
    const long = `${'d'.repeat(120)}/index.html`
    const h = tarHeader(long, 1, 0)
    expect(field(h, 0, 100)).toBe('index.html')
    expect(field(h, 345, 155)).toBe('d'.repeat(120))
  })
})

describe('buildTar', () => {
  const files: ArtifactFile[] = [{ path: 'index.html', data: enc.encode('<html>') }]

  it('is 512-aligned, embeds the content, and ends with a 1024-byte zero trailer', () => {
    const tar = buildTar(files, 0)
    expect(tar.length % 512).toBe(0)
    expect(tar.length).toBe(512 /* header */ + 512 /* padded content */ + 1024 /* trailer */)
    expect(dec.decode(tar.slice(512, 518))).toBe('<html>')
    expect(Array.from(tar.slice(tar.length - 1024)).every((b) => b === 0)).toBe(true)
  })

  it('pads each file body up to a 512 boundary', () => {
    const tar = buildTar([{ path: 'a', data: new Uint8Array(513) }], 0) // 513 → 2 content blocks
    expect(tar.length).toBe(512 + 1024 + 1024) // header + 2 content blocks + trailer
  })
})

describe('stripCommonRoot (index.html lands at the archive root)', () => {
  it('strips the shared top folder from a folder pick', () => {
    const out = stripCommonRoot([
      { path: 'dist/index.html', data: new Uint8Array() },
      { path: 'dist/assets/app.js', data: new Uint8Array() },
    ])
    expect(out.map((f) => f.path)).toEqual(['index.html', 'assets/app.js'])
  })
  it('leaves paths untouched when they do not all share one root', () => {
    const inp = [
      { path: 'index.html', data: new Uint8Array() },
      { path: 'about.html', data: new Uint8Array() },
    ]
    expect(stripCommonRoot(inp).map((f) => f.path)).toEqual(['index.html', 'about.html'])
  })
})
