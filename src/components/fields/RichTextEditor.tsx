'use client'

/**
 * RichTextEditor — a native WYSIWYG on Meta's Lexical (the SAME engine Payload's
 * `richtext-lexical` uses), built fresh + thin over the core Lexical primitives
 * rather than importing Payload's feature-heavy field (which is coupled to
 * Payload's config/feature/i18n system — see the port investigation). It is a
 * standalone DOM island: `contenteditable` + a fixed toolbar, styled to the app's
 * dark theme via CSS variables, that reads/writes a Lexical `EditorState` JSON
 * string. It composes fine inside the Tamagui `@hanzo/data` form as a plain `<div>`.
 *
 * Features (the "match Payload" set): bold/italic/underline, H1/H2/H3 + paragraph +
 * blockquote, bullet & numbered lists, links, and undo/redo — over Lexical's own
 * commands (`FORMAT_TEXT_COMMAND`, `$setBlocksType`, `INSERT_*_LIST_COMMAND`,
 * `TOGGLE_LINK_COMMAND`). Serialization is Lexical-native and lossless.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { LexicalComposer } from '@lexical/react/LexicalComposer'
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin'
import { ContentEditable } from '@lexical/react/LexicalContentEditable'
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin'
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin'
import { ListPlugin } from '@lexical/react/LexicalListPlugin'
import { LinkPlugin } from '@lexical/react/LexicalLinkPlugin'
import { LexicalErrorBoundary } from '@lexical/react/LexicalErrorBoundary'
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { HeadingNode, QuoteNode, $createHeadingNode, $createQuoteNode, $isHeadingNode } from '@lexical/rich-text'
import { ListNode, ListItemNode, INSERT_UNORDERED_LIST_COMMAND, INSERT_ORDERED_LIST_COMMAND, $isListNode } from '@lexical/list'
import { LinkNode, TOGGLE_LINK_COMMAND, $isLinkNode } from '@lexical/link'
import { $setBlocksType } from '@lexical/selection'
import { $getNearestNodeOfType, mergeRegister } from '@lexical/utils'
import {
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $createParagraphNode,
  FORMAT_TEXT_COMMAND,
  UNDO_COMMAND,
  REDO_COMMAND,
  CAN_UNDO_COMMAND,
  CAN_REDO_COMMAND,
  SELECTION_CHANGE_COMMAND,
  COMMAND_PRIORITY_LOW,
  type EditorState,
  type LexicalEditor,
} from 'lexical'
import {
  Bold, Italic, Underline, List, ListOrdered, Link2,
  Undo2, Redo2, Heading1, Heading2, Heading3, Quote, Pilcrow,
} from '@hanzogui/lucide-icons-2'

import { toEditorState, fromEditorState, type SerializedLexicalState } from './richtext-serialize'
import './richtext.css'

type BlockKind = 'paragraph' | 'h1' | 'h2' | 'h3' | 'quote' | 'bullet' | 'number'

const EDITOR_NAMESPACE = 'hanzo-cms-richtext'

/** The shared node set (rich-text + list + link). Registered once per editor. */
const EDITOR_NODES = [HeadingNode, QuoteNode, ListNode, ListItemNode, LinkNode]

/** Minimal theme class names — styled in richtext.css against the app CSS vars. */
const EDITOR_THEME = {
  paragraph: 'hz-rt-p',
  quote: 'hz-rt-quote',
  heading: { h1: 'hz-rt-h1', h2: 'hz-rt-h2', h3: 'hz-rt-h3' },
  list: { ul: 'hz-rt-ul', ol: 'hz-rt-ol', listitem: 'hz-rt-li' },
  link: 'hz-rt-link',
  text: { bold: 'hz-rt-bold', italic: 'hz-rt-italic', underline: 'hz-rt-underline' },
}

export interface RichTextEditorProps {
  /** The stored field value (Lexical JSON string, or legacy plain text). */
  value: unknown
  /** Emit the next stored value (Lexical JSON string) on every edit. */
  onChange: (value: string) => void
  autoFocus?: boolean
  placeholder?: string
}

export function RichTextEditor({ value, onChange, autoFocus, placeholder }: RichTextEditorProps) {
  // The editor's initial state is captured ONCE (Lexical owns state after mount);
  // a `value` change from OUR own onChange must not remount/reset the cursor. The
  // key is derived from the FIRST value only (a fresh record → a fresh editor).
  const initialRef = useRef<SerializedLexicalState>(toEditorState(value))

  const initialConfig = {
    namespace: EDITOR_NAMESPACE,
    nodes: EDITOR_NODES,
    theme: EDITOR_THEME,
    editorState: (editor: LexicalEditor) => {
      // Load the captured initial state into the fresh editor.
      const state = editor.parseEditorState(JSON.stringify(initialRef.current))
      editor.setEditorState(state)
    },
    onError: (error: Error) => {
      // Never crash the whole form on an editor error — surface + continue.
      // eslint-disable-next-line no-console
      console.error('[richtext] lexical error:', error)
    },
  }

  const handleChange = useCallback(
    (editorState: EditorState) => {
      onChange(fromEditorState(editorState.toJSON() as unknown as SerializedLexicalState))
    },
    [onChange],
  )

  return (
    <div className="hz-rt-shell">
      <LexicalComposer initialConfig={initialConfig}>
        <Toolbar />
        <div className="hz-rt-editor-wrap">
          <RichTextPlugin
            contentEditable={<ContentEditable className="hz-rt-content" aria-label="Rich text editor" />}
            placeholder={<div className="hz-rt-placeholder">{placeholder ?? 'Write something…'}</div>}
            ErrorBoundary={LexicalErrorBoundary}
          />
        </div>
        <HistoryPlugin />
        <ListPlugin />
        <LinkPlugin />
        <OnChangePlugin onChange={handleChange} ignoreSelectionChange />
        {autoFocus ? <AutoFocus /> : null}
      </LexicalComposer>
    </div>
  )
}

/** Focus the editor on mount (create form). */
function AutoFocus() {
  const [editor] = useLexicalComposerContext()
  useEffect(() => {
    editor.focus()
  }, [editor])
  return null
}

/** The fixed toolbar — reflects the current selection's active formats + block. */
function Toolbar() {
  const [editor] = useLexicalComposerContext()
  const [bold, setBold] = useState(false)
  const [italic, setItalic] = useState(false)
  const [underline, setUnderline] = useState(false)
  const [isLink, setIsLink] = useState(false)
  const [block, setBlock] = useState<BlockKind>('paragraph')
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)

  const sync = useCallback(() => {
    const selection = $getSelection()
    if (!$isRangeSelection(selection)) return
    setBold(selection.hasFormat('bold'))
    setItalic(selection.hasFormat('italic'))
    setUnderline(selection.hasFormat('underline'))

    const anchorNode = selection.anchor.getNode()
    const element = anchorNode.getKey() === 'root' ? anchorNode : anchorNode.getTopLevelElementOrThrow()

    // Link (an inline node under the selection)
    const node = selection.anchor.getNode()
    const parent = node.getParent()
    setIsLink($isLinkNode(parent) || $isLinkNode(node))

    // Block kind
    if ($isListNode(element)) {
      const parentList = $getNearestNodeOfType(anchorNode, ListNode)
      const type = parentList ? parentList.getListType() : element.getListType()
      setBlock(type === 'number' ? 'number' : 'bullet')
    } else if ($isHeadingNode(element)) {
      const tag = element.getTag()
      setBlock(tag === 'h1' ? 'h1' : tag === 'h2' ? 'h2' : 'h3')
    } else {
      const t = element.getType()
      setBlock(t === 'quote' ? 'quote' : 'paragraph')
    }
  }, [])

  useEffect(() => {
    return mergeRegister(
      editor.registerUpdateListener(({ editorState }) => {
        editorState.read(sync)
      }),
      editor.registerCommand(
        SELECTION_CHANGE_COMMAND,
        () => {
          sync()
          return false
        },
        COMMAND_PRIORITY_LOW,
      ),
      editor.registerCommand(CAN_UNDO_COMMAND, (payload) => { setCanUndo(payload); return false }, COMMAND_PRIORITY_LOW),
      editor.registerCommand(CAN_REDO_COMMAND, (payload) => { setCanRedo(payload); return false }, COMMAND_PRIORITY_LOW),
    )
  }, [editor, sync])

  const setBlockKind = useCallback(
    (kind: BlockKind) => {
      if (kind === 'bullet') {
        editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined)
        return
      }
      if (kind === 'number') {
        editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined)
        return
      }
      editor.update(() => {
        const selection = $getSelection()
        if (!$isRangeSelection(selection)) return
        if (kind === 'quote') $setBlocksType(selection, () => $createQuoteNode())
        else if (kind === 'paragraph') $setBlocksType(selection, () => $createParagraphNode())
        else $setBlocksType(selection, () => $createHeadingNode(kind))
      })
    },
    [editor],
  )

  const toggleLink = useCallback(() => {
    if (isLink) {
      editor.dispatchCommand(TOGGLE_LINK_COMMAND, null)
      return
    }
    const url = typeof window !== 'undefined' ? window.prompt('Link URL', 'https://') : null
    if (url) editor.dispatchCommand(TOGGLE_LINK_COMMAND, url)
  }, [editor, isLink])

  return (
    <div className="hz-rt-toolbar" role="toolbar" aria-label="Formatting">
      <ToolBtn label="Undo" disabled={!canUndo} onClick={() => editor.dispatchCommand(UNDO_COMMAND, undefined)}><Undo2 size={15} /></ToolBtn>
      <ToolBtn label="Redo" disabled={!canRedo} onClick={() => editor.dispatchCommand(REDO_COMMAND, undefined)}><Redo2 size={15} /></ToolBtn>
      <Sep />
      <ToolBtn label="Bold" active={bold} onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'bold')}><Bold size={15} /></ToolBtn>
      <ToolBtn label="Italic" active={italic} onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'italic')}><Italic size={15} /></ToolBtn>
      <ToolBtn label="Underline" active={underline} onClick={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, 'underline')}><Underline size={15} /></ToolBtn>
      <Sep />
      <ToolBtn label="Paragraph" active={block === 'paragraph'} onClick={() => setBlockKind('paragraph')}><Pilcrow size={15} /></ToolBtn>
      <ToolBtn label="Heading 1" active={block === 'h1'} onClick={() => setBlockKind('h1')}><Heading1 size={15} /></ToolBtn>
      <ToolBtn label="Heading 2" active={block === 'h2'} onClick={() => setBlockKind('h2')}><Heading2 size={15} /></ToolBtn>
      <ToolBtn label="Heading 3" active={block === 'h3'} onClick={() => setBlockKind('h3')}><Heading3 size={15} /></ToolBtn>
      <ToolBtn label="Quote" active={block === 'quote'} onClick={() => setBlockKind('quote')}><Quote size={15} /></ToolBtn>
      <Sep />
      <ToolBtn label="Bulleted list" active={block === 'bullet'} onClick={() => setBlockKind('bullet')}><List size={15} /></ToolBtn>
      <ToolBtn label="Numbered list" active={block === 'number'} onClick={() => setBlockKind('number')}><ListOrdered size={15} /></ToolBtn>
      <Sep />
      <ToolBtn label="Link" active={isLink} onClick={toggleLink}><Link2 size={15} /></ToolBtn>
    </div>
  )
}

function ToolBtn({
  children, label, onClick, active, disabled,
}: {
  children: React.ReactNode
  label: string
  onClick: () => void
  active?: boolean
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      className={`hz-rt-btn${active ? ' hz-rt-btn-active' : ''}`}
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      // preventDefault keeps the editor selection while clicking the toolbar
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
    >
      {children}
    </button>
  )
}

function Sep() {
  return <span className="hz-rt-sep" aria-hidden />
}

/** Read the flattened plain text of the current editor (used by callers/tests). */
export function readPlainText(editor: LexicalEditor): string {
  let text = ''
  editor.getEditorState().read(() => {
    text = $getRoot().getTextContent()
  })
  return text
}
