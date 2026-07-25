'use client'

/**
 * The `@hanzo/data` field adapters for the `richText` type — the Display (read)
 * and Input (edit) components the field registry dispatches to. Registering these
 * (in `Provider.tsx`, right after `registerDefaultFields()`) upgrades EVERY
 * `richText` field across the console from the plain-textarea fallback to the real
 * Lexical WYSIWYG — a CMS Article/Page body, or any DocType/collection field typed
 * `RichText`. One registration, DRY, orthogonal (agent-A's Option A: no fork of
 * @hanzo/data).
 *
 * - Input  → the `RichTextEditor` island (contenteditable + toolbar), emitting the
 *            Lexical `EditorState` JSON string on every edit.
 * - Display→ the stored state rendered to sanitized HTML (Lexical's own
 *            `$generateHtmlFromNodes`), so read mode shows formatted content, not
 *            raw JSON. An empty/legacy value degrades honestly.
 */
import { useEffect, useMemo, useState } from 'react'
import { createEditor } from 'lexical'
import { $generateHtmlFromNodes } from '@lexical/html'
import { HeadingNode, QuoteNode } from '@lexical/rich-text'
import { ListNode, ListItemNode } from '@lexical/list'
import { LinkNode } from '@lexical/link'
import type { FieldDisplayProps, FieldInputProps } from '@hanzo/data'

import { RichTextEditor } from './RichTextEditor'
import { toEditorState, isEmptyState, toPlainText, type SerializedLexicalState } from './richtext-serialize'
import './richtext.css'

const READ_NODES = [HeadingNode, QuoteNode, ListNode, ListItemNode, LinkNode]

/**
 * A serialized Lexical state → sanitized HTML, via a throwaway headless editor.
 * Lexical generates the HTML from its own node tree (no arbitrary markup passes
 * through), so this is safe to inject. Returns '' for an empty/legacy value.
 */
function stateToHtml(value: unknown): string {
  if (isEmptyState(value)) return ''
  const state: SerializedLexicalState = toEditorState(value)
  let html = ''
  try {
    const editor = createEditor({ nodes: READ_NODES, namespace: 'hanzo-cms-richtext-read', onError: () => {} })
    const editorState = editor.parseEditorState(JSON.stringify(state))
    editor.setEditorState(editorState)
    editor.update(() => {
      html = $generateHtmlFromNodes(editor, null)
    })
  } catch {
    // A malformed state that slipped past the parser → fall back to plain text.
    return ''
  }
  return html
}

/** Read-only rich-text display — formatted HTML, or an honest empty marker. */
export function RichTextDisplay({ value }: FieldDisplayProps) {
  const html = useMemo(() => stateToHtml(value), [value])
  if (!html) {
    // Legacy plain-text body (pre-RichText) still shows its text; truly empty → dash.
    const plain = toPlainText(value)
    return plain ? (
      <div className="hz-rt-read">{plain}</div>
    ) : (
      <span style={{ color: 'var(--color9)' }}>—</span>
    )
  }
  return <div className="hz-rt-read" dangerouslySetInnerHTML={{ __html: html }} />
}

/** Editable rich-text input — the Lexical WYSIWYG. */
export function RichTextInput({ field, value, onChange, autoFocus }: FieldInputProps) {
  const meta = (field.metadata ?? {}) as { placeholder?: string }
  // Guard SSR: Lexical needs the DOM. Render a lightweight placeholder until mount,
  // then the editor (avoids a hydration mismatch on the contenteditable).
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted) {
    return (
      <div className="hz-rt-shell" style={{ minHeight: 218 }}>
        <div className="hz-rt-toolbar" />
        <div className="hz-rt-editor-wrap"><div className="hz-rt-content" /></div>
      </div>
    )
  }
  return (
    <RichTextEditor
      value={value}
      onChange={onChange}
      autoFocus={autoFocus}
      placeholder={meta.placeholder}
    />
  )
}
