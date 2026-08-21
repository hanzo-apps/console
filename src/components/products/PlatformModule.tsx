'use client'

/**
 * Platform — the project HUB product. One module, two routes:
 *   ''      → the deploy home (hero · deploy tiles · one-click OSS App Store · your
 *             projects) — `PlatformHome`. This is what platform.<brand> boots into.
 *   ':name' → one project's deploy hub (deploy · deployments · domains · config ·
 *             cross-surface links) — `PlatformDetail`
 *
 * The project is IAM-native (`ProjectApi`, keyed by `name`); deploy is the cloud site
 * store (`/v1/projects`, slug === the IAM name). ONE shared key across console,
 * hanzo.app, and hanzo.chat.
 */
import { PlatformHome } from './platform-home/PlatformHome'
import { PlatformDetail } from './platform-hub/PlatformDetail'

export function PlatformModule({ params }: { params: Record<string, string> }) {
  const name = params.name?.trim()
  return name ? <PlatformDetail name={name} /> : <PlatformHome />
}
