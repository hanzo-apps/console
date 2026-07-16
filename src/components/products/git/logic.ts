/**
 * Pure view logic for the Git dashboard — path math, blob decoding, language +
 * image detection, and tree sorting. No React / no network here, so every rule is
 * unit-tested in isolation (git/logic.test.ts). The gitea repo-view IA
 * (breadcrumb → tree → blob, README at root) is rebuilt on these primitives.
 */
import type { Blob, TreeEntry } from '~/lib/api/git'

/** Blobs larger than this render as a "too large" guard, never a megabyte of DOM. */
export const MAX_RENDER_BYTES = 512 * 1024

// ── Path helpers ─────────────────────────────────────────────────────────────

/** Normalize a repo path: strip leading/trailing slashes, collapse blanks. */
export const cleanPath = (path?: string): string =>
  (path ?? '')
    .split('/')
    .filter(Boolean)
    .join('/')

/** The parent directory of a path ('' for a top-level entry). */
export const parentPath = (path: string): string => {
  const parts = cleanPath(path).split('/').filter(Boolean)
  parts.pop()
  return parts.join('/')
}

/** The last segment of a path (the file/dir name). */
export const baseName = (path: string): string => {
  const parts = cleanPath(path).split('/').filter(Boolean)
  return parts[parts.length - 1] ?? ''
}

/** Cumulative breadcrumb crumbs for a path: [{name,path}] from root → leaf (root excluded). */
export const breadcrumbSegments = (path: string): { name: string; path: string }[] => {
  const parts = cleanPath(path).split('/').filter(Boolean)
  const out: { name: string; path: string }[] = []
  let acc = ''
  for (const p of parts) {
    acc = acc ? `${acc}/${p}` : p
    out.push({ name: p, path: acc })
  }
  return out
}

// ── Tree ordering ────────────────────────────────────────────────────────────

/** Directories first, then files; each group case-insensitive alphabetical (gitea order). */
export const sortTreeEntries = (entries: TreeEntry[]): TreeEntry[] =>
  [...entries].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'tree' ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  })

// ── File-kind detection ──────────────────────────────────────────────────────

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico', 'svg', 'avif'])
const MARKDOWN_EXT = new Set(['md', 'markdown', 'mdx'])

/** Lowercased extension without the dot ('' when none). */
export const extOf = (path: string): string => {
  const b = baseName(path)
  const i = b.lastIndexOf('.')
  return i > 0 ? b.slice(i + 1).toLowerCase() : ''
}

export const isImagePath = (path: string): boolean => IMAGE_EXT.has(extOf(path))
export const isMarkdownPath = (path: string): boolean => MARKDOWN_EXT.has(extOf(path))

/** README detection (any case, any extension) — drives the root auto-render + blob toggle. */
export const isReadmePath = (path: string): boolean => /^readme(\.[a-z0-9]+)?$/i.test(baseName(path))

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  svg: 'image/svg+xml',
  avif: 'image/avif',
}

/** Image mime type for a path ('' when not an image extension). */
export const imageMime = (path: string): string => MIME[extOf(path)] ?? ''

/** Human language label for the blob header, keyed off the extension. */
const LANG: Record<string, string> = {
  ts: 'TypeScript',
  tsx: 'TypeScript',
  js: 'JavaScript',
  jsx: 'JavaScript',
  mjs: 'JavaScript',
  cjs: 'JavaScript',
  go: 'Go',
  rs: 'Rust',
  py: 'Python',
  rb: 'Ruby',
  java: 'Java',
  kt: 'Kotlin',
  c: 'C',
  h: 'C',
  cpp: 'C++',
  cc: 'C++',
  hpp: 'C++',
  cs: 'C#',
  php: 'PHP',
  swift: 'Swift',
  sh: 'Shell',
  bash: 'Shell',
  zsh: 'Shell',
  sql: 'SQL',
  json: 'JSON',
  yaml: 'YAML',
  yml: 'YAML',
  toml: 'TOML',
  xml: 'XML',
  html: 'HTML',
  css: 'CSS',
  scss: 'SCSS',
  md: 'Markdown',
  markdown: 'Markdown',
  mdx: 'MDX',
  proto: 'Protobuf',
  dockerfile: 'Dockerfile',
  tf: 'Terraform',
  sol: 'Solidity',
}

export const languageForPath = (path: string): string => {
  if (/^dockerfile$/i.test(baseName(path))) return 'Dockerfile'
  if (/^makefile$/i.test(baseName(path))) return 'Makefile'
  const e = extOf(path)
  return LANG[e] ?? (e ? e.toUpperCase() : 'Text')
}

// ── Blob decoding ────────────────────────────────────────────────────────────

/** Decode a base64 string to UTF-8 text (multibyte-safe). */
export const decodeBase64Utf8 = (b64: string): string => {
  const bin = atob(b64.replace(/\s/g, ''))
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0))
  return new TextDecoder().decode(bytes)
}

/**
 * Decode a blob's bytes to displayable TEXT, or null when it can't be shown as text
 * (binary, or too large to render). `utf8` content is returned as-is; `base64` is
 * decoded. The caller shows a download/preview affordance instead of null text.
 */
export const decodeBlobText = (blob: Blob): string | null => {
  if (blob.binary) return null
  if (blob.size > MAX_RENDER_BYTES || blob.truncated) return null
  if (blob.encoding === 'base64') {
    try {
      return decodeBase64Utf8(blob.content)
    } catch {
      return null
    }
  }
  return blob.content
}

/** A `data:` URL for an image blob (base64 → data URI; utf8 svg → encoded), '' otherwise. */
export const imageDataUrl = (blob: Blob): string => {
  const mime = imageMime(blob.path)
  if (!mime) return ''
  if (blob.encoding === 'base64') return `data:${mime};base64,${blob.content}`
  // A utf8-encoded SVG (text) — inline it directly.
  if (mime === 'image/svg+xml') return `data:${mime};utf8,${encodeURIComponent(blob.content)}`
  return ''
}

/** Split text into lines for the numbered blob view (a trailing newline drops the phantom last line). */
export const splitLines = (text: string): string[] => {
  const lines = text.split('\n')
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

/** Decode a README's markdown source (utf8 as-is, base64 decoded); '' on failure. */
export const decodeReadme = (encoding: 'utf8' | 'base64', content: string): string => {
  if (encoding === 'base64') {
    try {
      return decodeBase64Utf8(content)
    } catch {
      return ''
    }
  }
  return content
}
