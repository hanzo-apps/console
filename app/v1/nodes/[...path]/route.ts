/**
 * Per-user proxy to the REAL luxd node RPC — the Nodes module's ONE transport.
 * The browser calls console2's OWN origin (`/v1/nodes/inventory`) with just the
 * session cookie; this handler resolves the caller, resolves the BRAND from the
 * request host, and fetches the allowlisted luxd RPC methods server-side for each
 * network that brand may see, returning NORMALIZED per-node rows. No RPC host or
 * method ever reaches the browser, and the browser can never choose either.
 *
 * Security (mirrors app/bootnode/[...path]/route.ts):
 *  - Session-gated: an unauthenticated caller gets 401 (the RPC data is public,
 *    but the console surface is authenticated, same as every other module).
 *  - Org/brand-aware: the network set is scoped by `nodeNetworksForBrand(brand)`,
 *    brand resolved from the host — so cloud.lux.cloud sees only Lux networks,
 *    console.hanzo.ai (hanzo) sees all.
 *  - Least privilege: the ONLY path is `inventory`, and the ONLY luxd methods
 *    called are the four read methods below — this is not a general RPC tunnel.
 */
import { type NextRequest, NextResponse } from 'next/server'

import { brandFromHost } from '~/config'
import { resolveUser } from '~/lib/server/identity'
import { nodeNetworksForBrand, type NodeNetworkId } from '~/lib/products/brand-scope'
import {
  NODE_NETWORK_META,
  combineInventory,
  normalizeChains,
  parseHeight,
  type NetworkInventory,
  type RawBlockchain,
  type RawPeer,
  type RawValidator,
} from '~/lib/api/nodes'

export const runtime = 'nodejs'

const trim = (s: string) => s.replace(/\/+$/, '')

/**
 * Public luxd RPC host per network — the ONLY endpoints this proxy will call.
 * These are PUBLIC RPC hosts (not secrets); each is overridable per-deploy so a
 * network can be repointed or disabled without a code change. A host that is
 * unset/unreachable yields an honest `not-reporting` network — never fake rows.
 */
const HOSTS: Record<NodeNetworkId, string> = {
  'lux-mainnet': trim(process.env.LUX_MAINNET_RPC ?? 'https://api.lux.network'),
  'lux-testnet': trim(process.env.LUX_TESTNET_RPC ?? 'https://api.lux-test.network'),
  'lux-devnet': trim(process.env.LUX_DEVNET_RPC ?? 'https://api.lux-dev.network'),
  'pars-mainnet': trim(process.env.PARS_MAINNET_RPC ?? 'https://api.pars.network'),
  // Zoo has no confirmed public primary-network host yet; the default is the
  // conventional host (api.<brand>.network) and reports honestly when unreachable.
  'zoo-mainnet': trim(process.env.ZOO_MAINNET_RPC ?? 'https://api.zoo.network'),
}

/** Per-network probe timeout (ms). */
const TIMEOUT_MS = Number(process.env.NODES_RPC_TIMEOUT_MS ?? 8000)

/** A single allowlisted luxd JSON-RPC call. `path` and `method` are fixed here. */
async function rpc<T>(
  host: string,
  path: '/v1/bc/P' | '/v1/info',
  method: string,
  signal: AbortSignal,
): Promise<T> {
  const res = await fetch(`${host}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method }),
    cache: 'no-store',
    signal,
  })
  if (!res.ok) throw new Error(`${method} ${res.status}`)
  const json = (await res.json()) as { result?: T; error?: { message?: string } }
  if (json?.error) throw new Error(json.error.message ?? `${method} error`)
  return json.result as T
}

/** Probe ONE network: validators + peers + version + height, normalized. */
async function probe(net: NodeNetworkId): Promise<NetworkInventory> {
  const meta = NODE_NETWORK_META[net]
  const host = HOSTS[net]
  const base: NetworkInventory = {
    id: net,
    chain: meta.chain,
    env: meta.env,
    label: meta.label,
    status: 'not-reporting',
    validators: 0,
    peers: 0,
    nodes: [],
    chains: [],
  }

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const [valR, peerR, verR, hgtR, chainR] = await Promise.allSettled([
      rpc<{ validators?: RawValidator[] }>(host, '/v1/bc/P', 'platform.getCurrentValidators', ctrl.signal),
      rpc<{ numPeers?: string; peers?: RawPeer[] }>(host, '/v1/info', 'info.peers', ctrl.signal),
      rpc<{ version?: string }>(host, '/v1/info', 'info.getNodeVersion', ctrl.signal),
      rpc<{ height?: string }>(host, '/v1/bc/P', 'platform.getHeight', ctrl.signal),
      rpc<{ blockchains?: RawBlockchain[] }>(host, '/v1/bc/P', 'platform.getBlockchains', ctrl.signal),
    ])

    const reachable =
      valR.status === 'fulfilled' || peerR.status === 'fulfilled' || chainR.status === 'fulfilled'
    if (!reachable) {
      const reason =
        valR.status === 'rejected'
          ? valR.reason
          : peerR.status === 'rejected'
            ? peerR.reason
            : chainR.status === 'rejected'
              ? chainR.reason
              : null
      base.error = reason instanceof Error ? reason.message : 'unreachable'
      return base
    }

    const validators = valR.status === 'fulfilled' ? valR.value?.validators : undefined
    const peers = peerR.status === 'fulfilled' ? peerR.value?.peers : undefined
    const nodes = combineInventory(validators, peers, net)

    base.status = 'reporting'
    base.nodes = nodes
    base.validators = nodes.filter((n) => n.role === 'validator').length
    base.peers = nodes.filter((n) => n.role === 'peer').length
    if (verR.status === 'fulfilled') base.version = verR.value?.version
    if (hgtR.status === 'fulfilled') base.height = parseHeight(hgtR.value?.height)
    // Chains are best-effort: a network can report validators/peers yet not answer
    // getBlockchains — then the chains list is honestly empty (no fabricated chains).
    if (chainR.status === 'fulfilled') base.chains = normalizeChains(chainR.value?.blockchains)
    return base
  } catch (e) {
    base.error = e instanceof Error ? e.message : String(e)
    return base
  } finally {
    clearTimeout(timer)
  }
}

async function forward(req: NextRequest, path: string[]): Promise<NextResponse> {
  // ONE endpoint — the inventory. No arbitrary RPC pass-through. This handler lives at
  // `app/v1/nodes/[...path]`, so the catch-all captures the sub-path after `/v1/nodes/`.
  if (path.join('/') !== 'inventory') {
    return NextResponse.json({ error: 'not found' }, { status: 404 })
  }

  const user = await resolveUser(req)
  if (!user) {
    return NextResponse.json({ error: 'Sign in to view node infrastructure.' }, { status: 401 })
  }

  const brand = brandFromHost(req.headers.get('host'))
  let networks = nodeNetworksForBrand(brand)

  // Optional single-network scope, still gated by the brand's allowed set.
  const only = req.nextUrl.searchParams.get('network') as NodeNetworkId | null
  if (only) networks = networks.filter((n) => n === only)

  const inventory = await Promise.all(networks.map(probe))
  return NextResponse.json({ brand, networks: inventory })
}

type Ctx = { params: Promise<{ path: string[] }> }

export async function GET(req: NextRequest, ctx: Ctx) {
  return forward(req, (await ctx.params).path)
}
