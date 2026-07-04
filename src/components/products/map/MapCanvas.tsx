'use client'

/**
 * The pannable/zoomable landscape canvas. Loaded ONLY client-side (via
 * `next/dynamic({ ssr: false })` in `MapModule`), because `@xyflow/react` touches
 * browser globals at import.
 *
 * The graph is read-only: positions come from the deterministic `layout`, nodes
 * are draggable for exploration but not connectable, and edges are computed, not
 * drawn. Route edges (domain→app) animate; reference edges (app→resource) are
 * dashed to signal they are the honest, env-derived links. All motion stops under
 * `prefers-reduced-motion`.
 */
import { useCallback, useMemo, type CSSProperties } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  type Edge,
  type Node,
  type NodeMouseHandler,
} from '@xyflow/react'
import { useThemeSetting } from '@hanzogui/next-theme'
import '@xyflow/react/dist/style.css'

import { layout, type MapGraph, type MapNodeData } from './graph'
import { NODE_TYPES } from './nodes'
import { STATUS_COLOR } from './presentation'

export interface MapCanvasProps {
  graph: MapGraph
  reducedMotion: boolean
  onSelect: (data: MapNodeData | null) => void
}

function toFlow(graph: MapGraph, animate: boolean): { nodes: Node[]; edges: Edge[] } {
  const nodes: Node[] = layout(graph).map((n) => ({
    id: n.id,
    type: 'service',
    position: n.position,
    data: n.data as unknown as Record<string, unknown>,
    connectable: false,
  }))
  const edges: Edge[] = graph.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    animated: animate && e.reason === 'route',
    style: {
      stroke: 'var(--map-edge)',
      strokeWidth: 1.5,
      strokeDasharray: e.reason === 'reference' ? '4 4' : undefined,
    },
  }))
  return { nodes, edges }
}

/** Status-dot pulse keyframe (theme-independent); disabled under reduced motion. */
const CANVAS_CSS = `
.hz-map { height: 100%; width: 100%; }
.hz-map-dot { flex-shrink: 0; box-shadow: 0 0 0 0 rgba(63,185,80,0.5); }
.hz-map-dot--pulse { animation: hz-map-pulse 2.2s ease-out infinite; }
@keyframes hz-map-pulse {
  0% { box-shadow: 0 0 0 0 rgba(63,185,80,0.45); }
  70% { box-shadow: 0 0 0 6px rgba(63,185,80,0); }
  100% { box-shadow: 0 0 0 0 rgba(63,185,80,0); }
}
@media (prefers-reduced-motion: reduce) { .hz-map-dot--pulse { animation: none; } }
`

/** Edge/dot hues per resolved theme (matched to the console's neutral borders). */
const THEME_VARS = {
  dark: { '--map-edge': '#30363d', '--map-dots': '#262c33' },
  light: { '--map-edge': '#d0d7de', '--map-dots': '#d8dee4' },
} as const

export default function MapCanvas({ graph, reducedMotion, onSelect }: MapCanvasProps) {
  const { nodes, edges } = useMemo(() => toFlow(graph, !reducedMotion), [graph, reducedMotion])
  // Drive the canvas chrome (minimap/controls) + edge/dot hues off the REAL app
  // theme, not prefers-color-scheme — the console themes via next-theme, so
  // `colorMode="system"` would desync the widgets from a manually-set theme.
  const { current, resolvedTheme } = useThemeSetting()
  const colorMode: 'light' | 'dark' = (resolvedTheme ?? current ?? 'dark') === 'light' ? 'light' : 'dark'

  const onNodeClick = useCallback<NodeMouseHandler>(
    (_event, node) => onSelect(node.data as unknown as MapNodeData),
    [onSelect],
  )

  return (
    <ReactFlowProvider>
      <style>{CANVAS_CSS}</style>
      <div className="hz-map" style={THEME_VARS[colorMode] as unknown as CSSProperties}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={NODE_TYPES}
          onNodeClick={onNodeClick}
          onPaneClick={() => onSelect(null)}
          fitView
          fitViewOptions={{ padding: 0.24, maxZoom: 1 }}
          minZoom={0.2}
          maxZoom={1.6}
          nodesConnectable={false}
          elementsSelectable
          colorMode={colorMode}
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} gap={16} size={1} color="var(--map-dots)" />
          <MiniMap
            pannable
            zoomable
            nodeStrokeWidth={0}
            nodeColor={(n) => STATUS_COLOR[(n.data as unknown as MapNodeData).status] ?? STATUS_COLOR.idle}
            maskColor="rgba(0,0,0,0.06)"
          />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </ReactFlowProvider>
  )
}
