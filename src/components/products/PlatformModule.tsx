'use client'

/**
 * Platform — the project HUB product. One module, two routes:
 *   ''      → the project list (create + open) — `PlatformList`
 *   ':name' → one project's deploy hub (deploy · deployments · domains · config ·
 *             cross-surface links) — `PlatformDetail`
 *
 * The project is IAM-native (`ProjectApi`, keyed by `name`); deploy is the cloud site
 * store (`/v1/platform/sites`, slug === the IAM name). ONE shared key across console,
 * hanzo.app, and hanzo.chat.
 */
import { PlatformList } from './platform-hub/PlatformList'
import { PlatformDetail } from './platform-hub/PlatformDetail'

export function PlatformModule({ params }: { params: Record<string, string> }) {
  const name = params.name?.trim()
  return name ? <PlatformDetail name={name} /> : <PlatformList />
}
