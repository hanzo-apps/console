'use client'

/**
 * Deploy — the console's "Let's build something new" hub: the ONE uniform surface
 * to deploy any new project/service/container/site. Thin route adapter over
 * `DeployHub`, which leads with repo→deploy against the real per-org Hanzo PaaS
 * (`/v1/platform/*`), a real connect-git dropdown (`/git/*`), and the real
 * template gallery (`/v1/templates`).
 */
import { DeployHub } from './deploy/DeployHub'

export function DeployModule(props: { params: Record<string, string> }) {
  return <DeployHub {...props} />
}

export default DeployModule
