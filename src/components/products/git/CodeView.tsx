'use client'

/**
 * Code view — the gitea-parity browse experience at a ref+path: a directory TREE
 * (folders first, click to descend), a BLOB view (line-numbered text with a language
 * badge + copy, image preview for images, honest guards for binary/too-large), and the
 * root README auto-rendered as markdown. The parent (RepoBrowser) owns the ref/path/view
 * state via the URL; this component fetches and renders for the given coordinates, and
 * degrades honestly (BackendStateCard) when a browse endpoint isn't live yet.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Card, ScrollView, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { ChevronUp, Code as CodeIcon, Eye, FileText } from '@hanzogui/lucide-icons-2'

import { GitApi, type Blob, type Readme, type TreeEntry } from '~/lib/api/git'
import { fmtBytes } from '~/lib/api/agents'
import { MarkdownView } from '~/components/products/playground/MarkdownView'
import { CopyButton, EntryIcon } from './parts'
import { AgentActions } from '../code/AgentActions'
import { askFilePrompt } from '../code/hub-logic'
import {
  MAX_RENDER_BYTES,
  decodeBlobText,
  decodeReadme,
  imageDataUrl,
  isImagePath,
  isMarkdownPath,
  isReadmePath,
  languageForPath,
  parentPath,
  sortTreeEntries,
  splitLines,
} from './logic'
import { BackendStateCard, classifyBackend, type BackendState } from '@hanzo/ui/product'

const EM = '—'

type Load<T> = { phase: 'loading' } | { phase: 'error'; error: BackendState } | { phase: 'ready'; data: T }

export function CodeView({
  name,
  refName,
  path,
  view,
  onNavigate,
}: {
  name: string
  refName: string
  path: string
  view: 'tree' | 'blob'
  /** Navigate to a new coordinate within the repo (updates the URL). */
  onNavigate: (path: string, view: 'tree' | 'blob') => void
}) {
  return view === 'blob' && path ? (
    <BlobPane name={name} refName={refName} path={path} />
  ) : (
    <TreePane name={name} refName={refName} path={path} onNavigate={onNavigate} />
  )
}

// ── Tree ─────────────────────────────────────────────────────────────────────

function TreePane({
  name,
  refName,
  path,
  onNavigate,
}: {
  name: string
  refName: string
  path: string
  onNavigate: (path: string, view: 'tree' | 'blob') => void
}) {
  const [state, setState] = useState<Load<TreeEntry[]>>({ phase: 'loading' })

  const load = useCallback(() => {
    setState({ phase: 'loading' })
    GitApi.tree(name, refName, path)
      .then((entries) => setState({ phase: 'ready', data: sortTreeEntries(entries) }))
      .catch((e) => setState({ phase: 'error', error: classifyBackend(e) }))
  }, [name, refName, path])
  useEffect(() => {
    load()
  }, [load])

  return (
    <YStack gap="$4">
      <Card borderWidth={1} borderColor="$borderColor" p="$0" overflow="hidden">
        {state.phase === 'loading' ? (
          <XStack p="$5" justify="center">
            <Spinner size="small" color="$color11" />
          </XStack>
        ) : state.phase === 'error' ? (
          <YStack p="$3">
            <BackendStateCard state={state.error} onRetry={load} hint={`endpoint · GET /v1/git/repos/${name}/tree?ref=${refName}&path=${path}`} />
          </YStack>
        ) : state.data.length === 0 ? (
          <YStack p="$6" items="center" gap="$1">
            <Text fontSize="$3" color="$color10">
              This directory is empty.
            </Text>
          </YStack>
        ) : (
          <YStack>
            {path ? (
              <XStack
                items="center"
                gap="$2"
                px="$3"
                py="$2"
                borderBottomWidth={1}
                borderColor="$borderColor"
                cursor="pointer"
                hoverStyle={{ bg: '$color2' }}
                onPress={() => onNavigate(parentPath(path), 'tree')}
              >
                <ChevronUp size={15} color="$color10" />
                <Text className="hz-mono" fontSize="$2" color="$color11">
                  ..
                </Text>
              </XStack>
            ) : null}
            {state.data.map((e, i) => (
              <XStack
                key={e.path}
                items="center"
                gap="$2"
                px="$3"
                py="$2"
                borderTopWidth={i === 0 && !path ? 0 : 1}
                borderColor="$borderColor"
                cursor="pointer"
                hoverStyle={{ bg: '$color2' }}
                onPress={() => onNavigate(e.path, e.type === 'tree' ? 'tree' : 'blob')}
              >
                <EntryIcon type={e.type} />
                <Text fontSize="$3" color="$color12" flex={1} numberOfLines={1}>
                  {e.name}
                </Text>
                <Text className="hz-mono" fontSize="$2" color="$color9">
                  {e.type === 'blob' ? fmtBytes(e.size) : ''}
                </Text>
              </XStack>
            ))}
          </YStack>
        )}
      </Card>

      {/* README auto-render at the repo root (gitea home). */}
      {path === '' ? <ReadmeCard name={name} refName={refName} /> : null}
    </YStack>
  )
}

// ── README ───────────────────────────────────────────────────────────────────

function ReadmeCard({ name, refName }: { name: string; refName: string }) {
  const [readme, setReadme] = useState<Readme | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let live = true
    setLoaded(false)
    GitApi.readme(name, refName)
      .then((r) => {
        if (live) setReadme(r)
      })
      .catch(() => {
        // A repo with no README (or the endpoint not live) → render nothing, never an error.
        if (live) setReadme(null)
      })
      .finally(() => {
        if (live) setLoaded(true)
      })
    return () => {
      live = false
    }
  }, [name, refName])

  if (!loaded || !readme || !readme.content) return null
  const text = decodeReadme(readme.encoding, readme.content)
  if (!text.trim()) return null

  return (
    <Card borderWidth={1} borderColor="$borderColor" p="$0" overflow="hidden">
      <XStack items="center" gap="$2" px="$3" py="$2" borderBottomWidth={1} borderColor="$borderColor" bg="$color2">
        <FileText size={14} color="$color10" />
        <Text className="hz-mono" fontSize="$2" color="$color11">
          {readme.path}
        </Text>
      </XStack>
      <YStack p="$4">
        <MarkdownView text={text} />
      </YStack>
    </Card>
  )
}

// ── Blob ─────────────────────────────────────────────────────────────────────

function BlobPane({ name, refName, path }: { name: string; refName: string; path: string }) {
  const [state, setState] = useState<Load<Blob | null>>({ phase: 'loading' })
  const [rendered, setRendered] = useState(true) // markdown: rendered vs source

  const load = useCallback(() => {
    setState({ phase: 'loading' })
    GitApi.blob(name, refName, path)
      .then((data) => setState({ phase: 'ready', data }))
      .catch((e) => setState({ phase: 'error', error: classifyBackend(e) }))
  }, [name, refName, path])
  useEffect(() => {
    load()
  }, [load])

  if (state.phase === 'loading') {
    return (
      <Card borderWidth={1} borderColor="$borderColor" p="$5">
        <XStack justify="center">
          <Spinner size="small" color="$color11" />
        </XStack>
      </Card>
    )
  }
  if (state.phase === 'error') {
    return <BackendStateCard state={state.error} onRetry={load} hint={`endpoint · GET /v1/git/repos/${name}/blob?ref=${refName}&path=${path}`} />
  }
  const blob = state.data
  if (!blob) {
    return (
      <Card borderWidth={1} borderColor="$borderColor" p="$5">
        <Text fontSize="$3" color="$color10">
          This file no longer exists at this ref.
        </Text>
      </Card>
    )
  }

  const image = isImagePath(blob.path)
  const dataUrl = image ? imageDataUrl(blob) : ''
  const text = image ? null : decodeBlobText(blob)
  const markdown = isMarkdownPath(blob.path) || isReadmePath(blob.path)
  const lines = text != null ? splitLines(text) : []

  return (
    <Card borderWidth={1} borderColor="$borderColor" p="$0" overflow="hidden">
      {/* File header — language + size + lines, a copy control, and a markdown render toggle. */}
      <XStack items="center" justify="space-between" gap="$2" px="$3" py="$2" borderBottomWidth={1} borderColor="$borderColor" bg="$color2" flexWrap="wrap">
        <XStack items="center" gap="$2" minW={0}>
          <Text fontSize="$2" color="$color10">
            {languageForPath(blob.path)}
          </Text>
          <Text fontSize="$2" color="$color9">
            ·
          </Text>
          <Text className="hz-mono" fontSize="$2" color="$color9">
            {fmtBytes(blob.size)}
          </Text>
          {text != null ? (
            <>
              <Text fontSize="$2" color="$color9">
                ·
              </Text>
              <Text className="hz-mono" fontSize="$2" color="$color9">
                {lines.length} {lines.length === 1 ? 'line' : 'lines'}
              </Text>
            </>
          ) : null}
        </XStack>
        <XStack items="center" gap="$1">
          {markdown && text != null ? (
            <Button
              size="$2"
              chromeless
              icon={rendered ? <CodeIcon size={14} /> : <Eye size={14} />}
              onPress={() => setRendered((v) => !v)}
              aria-label={rendered ? 'View source' : 'View rendered'}
            >
              <Text fontSize="$2" color="$color11">
                {rendered ? 'Source' : 'Rendered'}
              </Text>
            </Button>
          ) : null}
          {text != null ? <CopyButton value={text} label="Copy file contents" id="file-contents" /> : null}
          {/* File-level agentic handoff — Ask the built-in assistant about THIS file,
              seeded with its (bounded) content. Edit/Chat are repo-level (shown once in
              the repo header), so this is Ask-only. */}
          {text != null ? (
            <AgentActions
              repo={name}
              seedPrompt={askFilePrompt(name, blob.path, languageForPath(blob.path), text)}
              askOnly
            />
          ) : null}
        </XStack>
      </XStack>

      {/* Body — image preview, rendered markdown, line-numbered text, or an honest guard. */}
      {image ? (
        dataUrl ? (
          <YStack p="$4" items="center" bg="$color1">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={dataUrl} alt={blob.path} style={{ maxWidth: '100%', maxHeight: 640, objectFit: 'contain' }} />
          </YStack>
        ) : (
          <Guard message="This image can’t be previewed inline." />
        )
      ) : text == null ? (
        <Guard
          message={
            blob.binary
              ? 'This is a binary file and can’t be displayed.'
              : blob.truncated || blob.size > MAX_RENDER_BYTES
                ? `This file is too large to display (${fmtBytes(blob.size)}).`
                : 'This file can’t be displayed as text.'
          }
        />
      ) : markdown && rendered ? (
        <YStack p="$4">
          <MarkdownView text={text} />
        </YStack>
      ) : (
        <CodeLines lines={lines} />
      )}
    </Card>
  )
}

/** Line-numbered, horizontally-scrollable monospace file body. */
function CodeLines({ lines }: { lines: string[] }) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator bg="$color1">
      <XStack>
        {/* Gutter — right-aligned line numbers, non-selectable. */}
        <YStack py="$2" px="$3" bg="$color2" borderRightWidth={1} borderColor="$borderColor" items="flex-end">
          {lines.map((_, i) => (
            <Text key={i} className="hz-mono" fontSize="$2" color="$color9" style={{ lineHeight: '20px', userSelect: 'none' }}>
              {i + 1}
            </Text>
          ))}
        </YStack>
        {/* Content — pre-formatted, selectable. */}
        <YStack py="$2" px="$3">
          {lines.map((ln, i) => (
            <Text
              key={i}
              className="hz-mono"
              fontSize="$2"
              color="$color12"
              selectable
              style={{ lineHeight: '20px', whiteSpace: 'pre' }}
            >
              {ln === '' ? ' ' : ln}
            </Text>
          ))}
        </YStack>
      </XStack>
    </ScrollView>
  )
}

/** An honest, non-fabricated guard body for a file that can't be rendered. */
function Guard({ message }: { message: string }) {
  return (
    <YStack p="$6" items="center" gap="$1" bg="$color1">
      <Text fontSize="$3" color="$color10" text="center">
        {message}
      </Text>
      <Text fontSize="$2" color="$color9" text="center">
        Clone the repository to view it locally.
      </Text>
    </YStack>
  )
}

export { EM }
