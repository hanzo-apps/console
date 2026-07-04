'use client'

/**
 * Shared presentation for the Map — icon, label, and status-dot helpers used by
 * BOTH the canvas node cards and the side panel. It imports NO canvas library, so
 * the module (and thus the whole registry) stays free of `@xyflow/react` on the
 * server; only `MapCanvas` pulls the canvas in, client-side.
 */
import { YStack } from '@hanzo/gui'
import { Box, Boxes, Database, FileText, Globe, HardDrive, Key, Search, Server } from '@hanzogui/lucide-icons-2'

import type { MapNodeData, MapNodeKind, NodeStatus, ResourceWithKind } from './graph'

/** A lucide icon component — same shape the product registry uses (`ProductIcon`). */
export type Icon = typeof Server

/** The dot/minimap tone per status — semantic hues that read in light and dark. */
export const STATUS_COLOR: Record<NodeStatus, string> = {
  ok: '#3fb950',
  building: '#d29922',
  error: '#f85149',
  idle: '#8b949e',
}

const RESOURCE_ICON: Record<ResourceWithKind['kind'], Icon> = {
  sql: Database,
  vector: Boxes,
  kv: Key,
  search: Search,
  s3: HardDrive,
  datastore: Server,
  docdb: FileText,
}

/** The icon for a node — kind first, then the resource sub-kind. */
export function iconFor(data: MapNodeData): Icon {
  if (data.kind === 'domain') return Globe
  if (data.kind === 'app') return Box
  return (data.resourceKind && RESOURCE_ICON[data.resourceKind]) || Server
}

const KIND_LABEL: Record<MapNodeKind, string> = {
  domain: 'Domain',
  app: 'App',
  resource: 'Data resource',
}

export const kindLabel = (kind: MapNodeKind): string => KIND_LABEL[kind]

const PRODUCT_LABEL: Record<string, string> = {
  'app-platform': 'App Platform',
  applications: 'Applications',
  sql: 'SQL',
  vector: 'Vector',
  kv: 'KV',
  search: 'Search',
  s3: 'S3',
  datastore: 'Datastore',
  docdb: 'DocDB',
}

export const productLabel = (id: string): string =>
  PRODUCT_LABEL[id] ?? id.charAt(0).toUpperCase() + id.slice(1)

/**
 * The status dot. `ok` pulses (a live service breathing); the pulse is a CSS
 * keyframe defined in `MapCanvas`, disabled under `prefers-reduced-motion`, so
 * there is no motion for users who ask for none.
 */
export function StatusDot({ status }: { status: NodeStatus }) {
  return (
    <YStack
      width={9}
      height={9}
      rounded={999}
      className={status === 'ok' ? 'hz-map-dot hz-map-dot--pulse' : 'hz-map-dot'}
      style={{ background: STATUS_COLOR[status] }}
    />
  )
}
