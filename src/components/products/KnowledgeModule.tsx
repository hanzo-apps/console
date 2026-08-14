'use client'

/**
 * Knowledge — the org's KB knowledge graph over the REAL cloud `/v1/kb` surface
 * (cloud `clients/knowledge`). Two lenses, one module:
 *
 *  - Graph: a force-directed view of `/v1/kb/graph` — kb-page / kb-memory / kb-source
 *    nodes, with the parent tree, wikilinks, and connector provenance as edges. Rendered
 *    on a dependency-free canvas (CSP-safe) driven by the pure `graph-logic`; click a
 *    node to inspect it and its connections.
 *  - Import: choose an Obsidian vault zip, Notion export zip, Roam JSON, or Evernote
 *    .enex and file it as a kb-page tree with the links intact (`POST /v1/kb/import`).
 *
 * Org-scoped SERVER-SIDE (the `/v1` bearer proxy); no credential in the browser. Honest
 * states throughout: loading, BackendStateCard, and an empty "import your notes" call to
 * action — never a fabricated node. @hanzo/gui v5 shorthands; dynamic hex swatches use a
 * raw styled element (the Tamagui color props take tokens, not arbitrary strings).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { FileUp, Network, RefreshCw, Upload } from '@hanzogui/lucide-icons-2'

import { KnowledgeApi, type ImportResult } from '~/lib/api/knowledge'
import { toneColor } from '~/components/ui/tone'
import { RAMP } from '~/lib/theme/ramp'
import {
  degreeOf,
  edgeColor,
  hitTest,
  initLayout,
  nodeColor,
  normalizeGraph,
  stepLayout,
  type Graph,
  type GraphNode,
  type LayoutState,
} from './knowledge/graph-logic'
import { BackendStateCard, PageHeader, PrimaryButton, classifyBackend, type BackendState } from '@hanzo/ui/product'

type Async<T> = { phase: 'loading' } | { phase: 'error'; error: BackendState } | { phase: 'ready'; data: T }

type Tab = 'graph' | 'import'

const FORMATS: { id: string; label: string; accept: string }[] = [
  { id: 'obsidian', label: 'Obsidian vault (.zip)', accept: '.zip' },
  { id: 'notion', label: 'Notion export (.zip)', accept: '.zip' },
  { id: 'roam', label: 'Roam JSON (.json)', accept: '.json,application/json' },
  { id: 'evernote', label: 'Evernote (.enex)', accept: '.enex,.xml' },
]

/** Dot is a small colour swatch for a legend / connection kind — a raw styled element
 *  because the hue is a dynamic hex, not a Tamagui token. */
function Dot({ color, size = 10 }: { color: string; size?: number }) {
  return <span style={{ display: 'inline-block', width: size, height: size, borderRadius: size, background: color }} />
}

export function KnowledgeModule() {
  const [tab, setTab] = useState<Tab>('graph')
  const [state, setState] = useState<Async<Graph>>({ phase: 'loading' })

  const load = useCallback(() => {
    setState({ phase: 'loading' })
    KnowledgeApi.graph()
      .then((raw) => setState({ phase: 'ready', data: normalizeGraph(raw) }))
      .catch((e) => setState({ phase: 'error', error: classifyBackend(e) }))
  }, [])
  useEffect(() => {
    load()
  }, [load])

  const graph = state.phase === 'ready' ? state.data : null
  const isEmpty = graph != null && graph.nodes.length === 0

  return (
    <YStack gap="$4">
      <PageHeader
        title="Knowledge"
        subtitle="Your wiki, your agents' memory, and the sources you have ingested — one graph, so you can see what connects to what."
        actions={
          <XStack gap="$2" items="center">
            <TabButton active={tab === 'graph'} onPress={() => setTab('graph')} icon={<Network size={14} />} label="Graph" />
            <TabButton active={tab === 'import'} onPress={() => setTab('import')} icon={<FileUp size={14} />} label="Import" />
            {tab === 'graph' ? (
              <Button size="$3" onPress={load} icon={<RefreshCw size={14} />}>
                Refresh
              </Button>
            ) : null}
          </XStack>
        }
      />

      {tab === 'import' ? (
        <ImportPanel onImported={load} />
      ) : state.phase === 'loading' ? (
        <Card borderWidth={1} borderColor="$borderColor" p="$5">
          <Text color="$color11">Loading the knowledge graph…</Text>
        </Card>
      ) : state.phase === 'error' ? (
        <BackendStateCard state={state.error} onRetry={load} hint="GET /v1/kb/graph" />
      ) : isEmpty ? (
        <EmptyGraph onImport={() => setTab('import')} />
      ) : (
        <GraphView graph={graph as Graph} />
      )}
    </YStack>
  )
}

function TabButton({ active, onPress, icon, label }: { active: boolean; onPress: () => void; icon: ReactElement; label: string }) {
  return (
    <Button
      size="$3"
      onPress={onPress}
      icon={icon}
      bg={active ? '$color5' : 'transparent'}
      borderWidth={1}
      borderColor={active ? '$color7' : '$borderColor'}
    >
      {label}
    </Button>
  )
}

const LEGEND: { type: string; label: string }[] = [
  { type: 'kb-page', label: 'Page' },
  { type: 'kb-memory', label: 'Memory' },
  { type: 'kb-source', label: 'Source' },
  { type: 'kb-connector', label: 'Connector' },
  { type: 'unresolved', label: 'Unresolved' },
]

function GraphView({ graph }: { graph: Graph }) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const layoutRef = useRef<LayoutState | null>(null)

  const deg = useMemo(() => degreeOf(graph), [graph])
  const byId = useMemo(() => {
    const m: Record<string, GraphNode> = {}
    for (const n of graph.nodes) m[n.id] = n
    return m
  }, [graph])

  // Force-directed settle: run the simulation on a canvas, animating for a bounded
  // number of frames, then a static repaint. Pure force math lives in graph-logic.
  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
    const width = Math.max(320, Math.floor(wrap.clientWidth))
    const height = 480
    canvas.width = Math.floor(width * dpr)
    canvas.height = Math.floor(height * dpr)
    canvas.style.width = `${width}px`
    canvas.style.height = `${height}px`
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.scale(dpr, dpr)

    const s = initLayout(graph, width, height)
    layoutRef.current = s

    let frame = 0
    let raf = 0
    const maxFrames = 320
    const draw = () => {
      ctx.clearRect(0, 0, width, height)
      for (const e of graph.edges) {
        const a = s.index[e.from]
        const b = s.index[e.to]
        if (a == null || b == null) continue
        ctx.strokeStyle = edgeColor(e.kind)
        ctx.globalAlpha = 0.5
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(s.pos[a].x, s.pos[a].y)
        ctx.lineTo(s.pos[b].x, s.pos[b].y)
        ctx.stroke()
      }
      ctx.globalAlpha = 1
      for (let i = 0; i < s.pos.length; i++) {
        const node = byId[s.ids[i]]
        if (!node) continue
        const r = 4 + Math.min(8, deg[node.id] ?? 0)
        const isSel = selected === node.id
        ctx.beginPath()
        ctx.arc(s.pos[i].x, s.pos[i].y, r, 0, Math.PI * 2)
        ctx.fillStyle = nodeColor(node.type)
        ctx.globalAlpha = node.type === 'unresolved' ? 0.6 : 1
        ctx.fill()
        if (isSel) {
          ctx.globalAlpha = 1
          ctx.lineWidth = 2
          ctx.strokeStyle = RAMP[0]
          ctx.stroke()
        }
        ctx.globalAlpha = 1
        if (isSel || (deg[node.id] ?? 0) >= 2) {
          ctx.fillStyle = RAMP[3]
          ctx.font = '11px system-ui, sans-serif'
          ctx.fillText(truncate(node.title, 22), s.pos[i].x + r + 3, s.pos[i].y + 3)
        }
      }
    }

    const tick = () => {
      if (frame < maxFrames) {
        stepLayout(s, graph)
        frame++
      }
      draw()
      if (frame < maxFrames) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [graph, byId, deg, selected])

  const onCanvasClick = (ev: React.MouseEvent<HTMLCanvasElement>) => {
    const s = layoutRef.current
    const canvas = canvasRef.current
    if (!s || !canvas) return
    const rect = canvas.getBoundingClientRect()
    setSelected(hitTest(s, ev.clientX - rect.left, ev.clientY - rect.top, 12))
  }

  const selectedNode = selected ? byId[selected] : null
  const neighbors = useMemo(() => {
    if (!selected) return [] as { node: GraphNode; kind: string }[]
    const out: { node: GraphNode; kind: string }[] = []
    for (const e of graph.edges) {
      if (e.from === selected && byId[e.to]) out.push({ node: byId[e.to], kind: e.kind })
      else if (e.to === selected && byId[e.from]) out.push({ node: byId[e.from], kind: e.kind })
    }
    return out
  }, [selected, graph, byId])

  return (
    <YStack gap="$4">
      <XStack gap="$3" flexWrap="wrap" items="center">
        {LEGEND.map((l) => (
          <XStack key={l.type} gap="$2" items="center">
            <Dot color={nodeColor(l.type)} />
            <Text fontSize="$2" color="$color11">
              {l.label}
            </Text>
          </XStack>
        ))}
        <Text fontSize="$2" color="$color10">
          {graph.nodes.length} nodes · {graph.edges.length} edges
        </Text>
      </XStack>

      <XStack gap="$4" flexWrap="wrap">
        <YStack flex={1} minW={320}>
          <Card borderWidth={1} borderColor="$borderColor" p="$2" overflow="hidden">
            <div ref={wrapRef} style={{ width: '100%' }}>
              <canvas ref={canvasRef} onClick={onCanvasClick} style={{ display: 'block', cursor: 'pointer' }} />
            </div>
          </Card>
        </YStack>

        <YStack width={280} minW={240} gap="$2">
          {selectedNode ? (
            <Card borderWidth={1} borderColor="$borderColor" p="$4" gap="$2">
              <Text fontSize="$5" fontWeight="700">
                {selectedNode.title}
              </Text>
              <Text fontSize="$2" color="$color10">
                {selectedNode.type}
                {selectedNode.project ? ` · ${selectedNode.project}` : ''}
              </Text>
              <Text fontSize="$3" fontWeight="600" mt="$2">
                Connections ({neighbors.length})
              </Text>
              {neighbors.length === 0 ? (
                <Text fontSize="$2" color="$color10">
                  No connections.
                </Text>
              ) : (
                neighbors.slice(0, 20).map((nb, i) => (
                  <XStack key={`${nb.node.id}-${i}`} gap="$2" items="center">
                    <Dot color={edgeColor(nb.kind)} size={8} />
                    <Text fontSize="$2" color="$color11">
                      {truncate(nb.node.title, 26)}
                    </Text>
                    <Text fontSize="$1" color="$color9">
                      {nb.kind}
                    </Text>
                  </XStack>
                ))
              )}
            </Card>
          ) : (
            <Card borderWidth={1} borderColor="$borderColor" p="$4">
              <Text fontSize="$3" color="$color11">
                Click a node to inspect it and its connections.
              </Text>
            </Card>
          )}
        </YStack>
      </XStack>
    </YStack>
  )
}

function ImportPanel({ onImported }: { onImported: () => void }) {
  const [format, setFormat] = useState('obsidian')
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const accept = FORMATS.find((f) => f.id === format)?.accept ?? ''

  const doImport = async () => {
    if (!file) return
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const bytes = await file.arrayBuffer()
      const res = await KnowledgeApi.importVault(format, bytes)
      setResult(res ?? { format, imported: 0 })
      if ((res?.imported ?? 0) > 0) onImported()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card borderWidth={1} borderColor="$borderColor" p="$5" gap="$4" maxW={640}>
      <YStack gap="$1">
        <Text fontSize="$5" fontWeight="700">
          Import your notes
        </Text>
        <Text fontSize="$3" color="$color11">
          Bring an existing knowledge base into Hanzo. Wikilinks and the page tree are
          preserved as real links, and every page is indexed for retrieval.
        </Text>
      </YStack>

      <YStack gap="$2">
        <Text fontSize="$2" color="$color10">
          Format
        </Text>
        <XStack gap="$2" flexWrap="wrap">
          {FORMATS.map((f) => (
            <Button
              key={f.id}
              size="$3"
              onPress={() => {
                setFormat(f.id)
                setFile(null)
                setResult(null)
              }}
              bg={format === f.id ? '$color5' : 'transparent'}
              borderWidth={1}
              borderColor={format === f.id ? '$color7' : '$borderColor'}
            >
              {f.label}
            </Button>
          ))}
        </XStack>
      </YStack>

      <YStack gap="$2">
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null)
            setResult(null)
            setError(null)
          }}
          style={{ display: 'none' }}
        />
        <XStack gap="$2" items="center" flexWrap="wrap">
          <Button size="$3" icon={<Upload size={14} />} onPress={() => inputRef.current?.click()}>
            Choose file
          </Button>
          <Text fontSize="$2" color="$color11">
            {file ? file.name : 'No file selected'}
          </Text>
        </XStack>
      </YStack>

      <XStack>
        <PrimaryButton size="$4" disabled={!file || busy} opacity={!file || busy ? 0.5 : 1} onPress={doImport} icon={<FileUp size={16} />}>
          {busy ? 'Importing…' : 'Import'}
        </PrimaryButton>
      </XStack>

      {result ? (
        <Text fontSize="$3" color="$green10">
          Imported {result.imported} page{result.imported === 1 ? '' : 's'} from your {result.format} export.
        </Text>
      ) : null}
      {error ? (
        <Text fontSize="$3" color="$red10">
          {error}
        </Text>
      ) : null}
    </Card>
  )
}

function EmptyGraph({ onImport }: { onImport: () => void }) {
  return (
    <Card borderWidth={1} borderColor="$borderColor" p="$6" gap="$3" items="center" maxW={640}>
      <Network size={32} color={toneColor('muted')} />
      <Text fontSize="$6" fontWeight="700">
        No knowledge yet
      </Text>
      <Text fontSize="$3" color="$color11" text="center">
        Create pages in the wiki, connect a source, or import an existing vault — the graph
        draws itself from your pages and their wikilinks.
      </Text>
      <PrimaryButton size="$4" icon={<FileUp size={16} />} onPress={onImport}>
        Import a vault
      </PrimaryButton>
    </Card>
  )
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s
}
