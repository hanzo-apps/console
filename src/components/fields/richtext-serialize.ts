/**
 * Pure serialization helpers for the Lexical rich-text field — the ONE place that
 * defines how a rich-text VALUE is stored and read back. No React, no DOM, no
 * Lexical runtime import (types only, erased at build), so this is trivially unit-
 * tested in plain Node.
 *
 * The stored value is a Lexical `SerializedEditorState` JSON string:
 *   `JSON.stringify(editor.getEditorState().toJSON())`
 * — lossless and portable (the same shape Payload's Lexical field stores). The
 * framework engine treats it as an opaque `RichText` string (validate.go coerces
 * it verbatim), so it round-trips through create→get untouched.
 *
 * Reads are DEFENSIVE: an empty string, a legacy plain-text value (from the old
 * `Text` body), or malformed JSON never throws — each degrades to a sensible
 * editor state (empty, or a single paragraph wrapping the plain text). A CMS body
 * authored before this field existed opens as editable plain text, not a crash.
 */

/** A minimal structural view of a Lexical serialized state (we don't import the
 *  runtime type to keep this dependency-free; the real editor validates the rest). */
export interface SerializedLexicalState {
  root: {
    type: 'root'
    children: unknown[]
    direction: 'ltr' | 'rtl' | null
    format: '' | 'left' | 'center' | 'right' | 'justify'
    indent: number
    version: 1
  }
}

/** The canonical empty document — one empty paragraph (what a fresh editor holds). */
export function emptyState(): SerializedLexicalState {
  return {
    root: {
      type: 'root',
      children: [
        {
          type: 'paragraph',
          children: [],
          direction: null,
          format: '',
          indent: 0,
          version: 1,
        },
      ],
      direction: null,
      format: '',
      indent: 0,
      version: 1,
    },
  }
}

/** A single-paragraph document wrapping one line of plain text (legacy migration). */
function plainTextState(text: string): SerializedLexicalState {
  const state = emptyState()
  if (text) {
    ;(state.root.children[0] as { children: unknown[] }).children = [
      { type: 'text', text, detail: 0, format: 0, mode: 'normal', style: '', version: 1 },
    ]
  }
  return state
}

/** True when a parsed object looks like a Lexical serialized state (has root.children). */
export function isSerializedState(v: unknown): v is SerializedLexicalState {
  return (
    !!v &&
    typeof v === 'object' &&
    'root' in v &&
    !!(v as { root?: unknown }).root &&
    typeof (v as { root: unknown }).root === 'object' &&
    Array.isArray((v as { root: { children?: unknown } }).root.children)
  )
}

/**
 * A stored field value → a Lexical serialized-state OBJECT the editor can load.
 * - a JSON string of a Lexical state → parsed as-is (the normal path)
 * - an already-parsed state object → returned as-is
 * - a non-empty plain string (legacy `Text` body, or malformed JSON) → wrapped in
 *   one paragraph so it opens as editable text
 * - empty / null / undefined → the empty document
 * Never throws.
 */
export function toEditorState(value: unknown): SerializedLexicalState {
  if (value == null) return emptyState()
  if (isSerializedState(value)) return value
  if (typeof value === 'string') {
    const s = value.trim()
    if (s === '') return emptyState()
    if (s.startsWith('{')) {
      try {
        const parsed = JSON.parse(s)
        if (isSerializedState(parsed)) return parsed
      } catch {
        /* fall through to plain-text wrap */
      }
    }
    return plainTextState(value)
  }
  return emptyState()
}

/** A Lexical serialized-state object → the stored string value (stable JSON). */
export function fromEditorState(state: SerializedLexicalState): string {
  return JSON.stringify(state)
}

/**
 * True when a serialized state carries no real content (only empty paragraphs /
 * whitespace). Used so an untouched editor stores `''` rather than an empty-doc
 * blob, and so the read view shows the empty affordance instead of blank HTML.
 */
export function isEmptyState(value: unknown): boolean {
  const state = toEditorState(value)
  return !nodeHasText(state.root)
}

/** Recursively true when a node subtree contains any non-whitespace text. */
function nodeHasText(node: unknown): boolean {
  if (!node || typeof node !== 'object') return false
  const n = node as { text?: unknown; children?: unknown; type?: unknown }
  if (typeof n.text === 'string' && n.text.trim() !== '') return true
  // A non-text leaf that carries meaning on its own (image, horizontal rule, …).
  if (typeof n.type === 'string' && LEAF_CONTENT_TYPES.has(n.type)) return true
  if (Array.isArray(n.children)) return n.children.some(nodeHasText)
  return false
}

/** Node types that are "content" even with no text (so the doc isn't "empty"). */
const LEAF_CONTENT_TYPES = new Set(['image', 'horizontalrule', 'upload'])

/**
 * A plain-text preview of a rich-text value — the flattened text, for table cells,
 * list rows, and search. Pure tree walk; never throws.
 */
export function toPlainText(value: unknown): string {
  const state = toEditorState(value)
  const out: string[] = []
  collectText(state.root, out)
  return out.join('').replace(/\s+/g, ' ').trim()
}

function collectText(node: unknown, out: string[]): void {
  if (!node || typeof node !== 'object') return
  const n = node as { text?: unknown; children?: unknown; type?: unknown }
  if (typeof n.text === 'string') out.push(n.text)
  if (n.type === 'linebreak' || n.type === 'paragraph') out.push(' ')
  if (Array.isArray(n.children)) for (const c of n.children) collectText(c, out)
}
