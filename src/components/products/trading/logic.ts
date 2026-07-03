/**
 * Trading module — pure view-model logic (no React, no I/O), unit-tested in
 * isolation (logic.test.ts). It projects the org's PaaS app fleet down to the
 * deployed BOTS, derives their network, and summarizes the fleet — so the module
 * component stays a thin renderer over real data.
 */
import type { PaasAppWithProject } from '~/lib/api/paas'
import type { BotInstance } from '~/lib/api/trading'
import { templateForImage } from '~/lib/products/trading/templates'

/** The image repository an app deploys (git apps carry it once built; else the configured image). */
export function appImageRepo(app: PaasAppWithProject): string | undefined {
  return app.image?.repository
}

/**
 * Derive the deployed network of a bot app from its env / environment. The maker's
 * COHERENCE_RPC (or the trader's LUX_RPC) carries the network namespace
 * (`…lux-testnet.svc…`); failing that, `environment` (production→mainnet,
 * staging→testnet). Undefined when nothing identifies it — honest, never guessed.
 */
export function deriveNetwork(app: PaasAppWithProject): string | undefined {
  const rpc =
    app.env?.find((e) => e.key === 'COHERENCE_RPC' || e.key === 'LUX_RPC')?.value ?? ''
  if (/lux-mainnet/.test(rpc)) return 'lux-mainnet'
  if (/lux-testnet/.test(rpc)) return 'lux-testnet'
  if (/lux-devnet/.test(rpc)) return 'lux-devnet'
  const env = (app.environment ?? '').toLowerCase()
  if (env === 'production') return 'lux-mainnet'
  if (env === 'staging') return 'lux-testnet'
  return undefined
}

/**
 * Project the org's whole PaaS app fleet down to deployed bots (an app whose image
 * is one of the bot templates). PURE. Apps that aren't bots are dropped; the result
 * is the Trading module's fleet list.
 */
export function botsFromApps(apps: PaasAppWithProject[]): BotInstance[] {
  const out: BotInstance[] = []
  for (const app of apps) {
    const repo = appImageRepo(app)
    const template = templateForImage(repo)
    if (!template) continue
    out.push({
      appId: app.id,
      project: app.project.slug || app.project.id,
      name: app.name,
      slug: app.slug,
      template: template.id,
      image: template.image,
      tag: app.image?.tag,
      status: app.status ?? app.phase ?? 'unknown',
      health: app.health,
      environment: app.environment,
      network: deriveNetwork(app),
    })
  }
  return out
}

/** Fleet counts by lifecycle — the header KPIs (all real, from the app statuses). */
export interface FleetSummary {
  total: number
  running: number
  stopped: number
  error: number
  makers: number
  traders: number
}

const RUNNING = new Set(['live', 'running', 'done', 'active', 'ready', 'succeeded'])
const STOPPED = new Set(['stopped', 'idle', 'draft', 'queued', 'building', 'deploying'])
const ERRORED = new Set(['error', 'failed', 'crashloop', 'degraded'])

/** Summarize a bot fleet by lifecycle + kind. PURE. */
export function summarizeFleet(bots: BotInstance[]): FleetSummary {
  const s: FleetSummary = { total: bots.length, running: 0, stopped: 0, error: 0, makers: 0, traders: 0 }
  for (const b of bots) {
    const st = (b.status || '').toLowerCase()
    // Health verdict wins when the app reports one (red → error even if "live").
    if ((b.health || '').toLowerCase() === 'red' || ERRORED.has(st)) s.error++
    else if (RUNNING.has(st)) s.running++
    else if (STOPPED.has(st)) s.stopped++
    if (b.template === 'market-maker') s.makers++
    else if (b.template === 'trader') s.traders++
  }
  return s
}

/** Whether a bot reads as running (for the start/stop control state). PURE. */
export function isBotRunning(b: BotInstance): boolean {
  const st = (b.status || '').toLowerCase()
  if ((b.health || '').toLowerCase() === 'red') return false
  return RUNNING.has(st)
}

/** A short, human network label from a network id (honest "—" when unknown). */
export function networkLabel(id?: string): string {
  switch (id) {
    case 'lux-mainnet':
      return 'Lux Mainnet'
    case 'lux-testnet':
      return 'Lux Testnet'
    case 'lux-devnet':
      return 'Lux Devnet'
    default:
      return '—'
  }
}
