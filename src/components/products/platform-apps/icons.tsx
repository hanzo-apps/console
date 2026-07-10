'use client'

/**
 * Maps a canvas node's `kind` to the console's lucide icon set, passed into
 * `@hanzo/canvas` (`ProjectCanvas`/`ServiceDetailDrawer`) via `renderIcon` so the
 * canvas uses the same iconography as every other console surface instead of the
 * package's built-in fallback glyphs. One place, DRY.
 */
import type { ServiceKind, ServiceNodeData } from '@hanzo/canvas'
import { Box, Boxes, Clock, Cpu, Database, Globe, HardDrive, Key, Layers, Search, Server, Zap } from '@hanzogui/lucide-icons-2'

const KIND_ICON: Record<ServiceKind, typeof Box> = {
  app: Box,
  web: Globe,
  worker: Cpu,
  database: Database,
  cache: Key,
  vector: Boxes,
  search: Search,
  storage: HardDrive,
  queue: Layers,
  domain: Globe,
  function: Zap,
  cron: Clock,
  ai: Cpu,
  service: Server,
}

export function renderServiceIcon(node: ServiceNodeData): React.ReactNode {
  const Icon = KIND_ICON[node.kind] ?? Server
  return <Icon size={17} />
}
