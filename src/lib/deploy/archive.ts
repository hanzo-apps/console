/**
 * Client-side artifact builder — turn a dropped FOLDER into a `tar.gz` the platform
 * deploy endpoint accepts (it content-sniffs zip/tar.gz by magic bytes). A dropped
 * `.zip`/`.tar.gz` FILE is uploaded verbatim; only a folder needs packing, and we pack
 * to an UNCOMPRESSED ustar tar (pure, tested) then gzip it with the browser-native
 * `CompressionStream('gzip')` — zero dependencies.
 *
 * `buildTar` is pure + unit-tested (valid ustar: 512-block aligned, octal size/mtime,
 * correct header checksum, two zero-block trailer). The gzip + File plumbing is a thin
 * browser wrapper over it.
 */

/** One file to pack: a relative POSIX path (no leading slash) + its bytes. */
export type ArtifactFile = { path: string; data: Uint8Array }

const enc = new TextEncoder()

/** Write an ASCII string into `buf` at `off`, up to `len` bytes (NUL-padded). */
function writeStr(buf: Uint8Array, off: number, len: number, s: string): void {
  const bytes = enc.encode(s)
  const n = Math.min(bytes.length, len)
  for (let i = 0; i < n; i++) buf[off + i] = bytes[i]
}

/** Write an octal number into a tar numeric field: `len-1` octal digits, NUL-terminated. */
function writeOctal(buf: Uint8Array, off: number, len: number, value: number): void {
  const s = Math.floor(value).toString(8).padStart(len - 1, '0')
  writeStr(buf, off, len - 1, s)
  buf[off + len - 1] = 0
}

/**
 * A single 512-byte ustar header for `path` (size `size`). Long names (>100 bytes)
 * split into the `prefix` (155) + `name` (100) fields per the ustar spec; a name that
 * still won't fit throws (static build paths are short — an honest failure beats a
 * silently-truncated, unservable artifact).
 */
export function tarHeader(path: string, size: number, mtime: number): Uint8Array {
  const h = new Uint8Array(512)
  let name = path.replace(/^\/+/, '')
  let prefix = ''
  if (enc.encode(name).length > 100) {
    const cut = name.lastIndexOf('/', name.length - 1)
    // Move leading path segments into `prefix` until `name` fits 100 bytes.
    let i = cut
    while (i > 0 && enc.encode(name.slice(i + 1)).length > 100) i = name.lastIndexOf('/', i - 1)
    if (i <= 0 || enc.encode(name.slice(i + 1)).length > 100) {
      throw new Error(`path too long for tar: ${path}`)
    }
    prefix = name.slice(0, i)
    name = name.slice(i + 1)
    if (enc.encode(prefix).length > 155) throw new Error(`path prefix too long for tar: ${path}`)
  }

  writeStr(h, 0, 100, name)
  writeOctal(h, 100, 8, 0o644) // mode
  writeOctal(h, 108, 8, 0) // uid
  writeOctal(h, 116, 8, 0) // gid
  writeOctal(h, 124, 12, size) // size
  writeOctal(h, 136, 12, mtime) // mtime
  h[156] = 0x30 // typeflag '0' = regular file
  writeStr(h, 257, 6, 'ustar') // magic (NUL-terminated → "ustar\0")
  h[263] = 0x30 // version "00"
  h[264] = 0x30
  if (prefix) writeStr(h, 345, 155, prefix)

  // Checksum: sum of all header bytes with the 8-byte chksum field taken as spaces.
  for (let i = 148; i < 156; i++) h[i] = 0x20
  let sum = 0
  for (let i = 0; i < 512; i++) sum += h[i]
  // 6 octal digits, NUL, space (the canonical GNU/BSD form).
  writeStr(h, 148, 6, sum.toString(8).padStart(6, '0'))
  h[154] = 0
  h[155] = 0x20
  return h
}

/** Pack `files` into an UNCOMPRESSED ustar archive (512-block aligned, zero-block trailer). */
export function buildTar(files: ArtifactFile[], mtime: number = Math.floor(Date.now() / 1000)): Uint8Array {
  const blocks: Uint8Array[] = []
  let total = 0
  for (const f of files) {
    const header = tarHeader(f.path, f.data.length, mtime)
    blocks.push(header)
    blocks.push(f.data)
    const rem = f.data.length % 512
    if (rem !== 0) blocks.push(new Uint8Array(512 - rem)) // pad content to a 512 boundary
    total += header.length + f.data.length + (rem !== 0 ? 512 - rem : 0)
  }
  // Two 512-byte zero blocks mark the end of the archive.
  const trailer = new Uint8Array(1024)
  blocks.push(trailer)
  total += 1024

  const out = new Uint8Array(total)
  let off = 0
  for (const b of blocks) {
    out.set(b, off)
    off += b.length
  }
  return out
}

/**
 * Strip the common leading directory shared by every path (a folder pick yields
 * `mydist/index.html`, `mydist/assets/…`), so `index.html` lands at the archive ROOT.
 * Pure; returns the paths unchanged when they don't all share one first segment.
 */
export function stripCommonRoot(files: ArtifactFile[]): ArtifactFile[] {
  if (files.length === 0) return files
  const first = (p: string) => p.replace(/^\/+/, '').split('/')[0]
  const root = first(files[0].path)
  if (!root) return files
  const allShare = files.every((f) => {
    const p = f.path.replace(/^\/+/, '')
    return p.startsWith(`${root}/`)
  })
  if (!allShare) return files
  return files.map((f) => ({ ...f, path: f.path.replace(/^\/+/, '').slice(root.length + 1) }))
}

/** True iff `CompressionStream` (native gzip) is available in this runtime. */
export function gzipSupported(): boolean {
  return typeof (globalThis as { CompressionStream?: unknown }).CompressionStream === 'function'
}

/** Gzip `bytes` with the browser-native `CompressionStream('gzip')`. */
export async function gzip(bytes: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('gzip')
  const writer = cs.writable.getWriter()
  void writer.write(bytes as BufferSource)
  void writer.close()
  const chunks: Uint8Array[] = []
  const reader = cs.readable.getReader()
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    if (value) chunks.push(value)
  }
  const total = chunks.reduce((n, c) => n + c.length, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const c of chunks) {
    out.set(c, off)
    off += c.length
  }
  return out
}

/** Pack `files` (folder pick) into a gzip'd tar, root-stripped so index.html is at root. */
export async function filesToTarGz(files: ArtifactFile[]): Promise<Uint8Array> {
  return gzip(buildTar(stripCommonRoot(files)))
}
