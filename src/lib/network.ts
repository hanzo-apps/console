'use client'

/**
 * Network model — the ONE description of a selectable network: the tuple
 * `(label, networkID, evmChainID, rpcEndpoint, apiEndpoint)` every chain read,
 * wallet action, RPC call, and cloud API call resolves against.
 *
 * Orthogonal to `lib/scope.ts` (which owns the project + environment SCOPING
 * string stamped as `X-Environment`) and `lib/org-scope.ts` (the org). This module
 * owns the CHAIN + ENDPOINT identity of the active network. The link between them:
 * the active network's `id` IS the active `environment` string — so selecting a
 * network re-scopes cloud calls (via `X-Environment`) AND retargets chain/RPC/API
 * in ONE move, with no parallel selection state.
 *
 * Network-ID model (honored exactly — see the platform rules):
 *  - Lux primary network IDs are convention-fixed: 1=mainnet, 2=testnet, 3=local,
 *    1337=localnet.
 *  - Sovereign L1 networks (Hanzo, Zoo, Pars) run their OWN primary network where
 *    `networkID == evmChainID` (one id per env per L1). This console is a Hanzo
 *    surface, so its stock networks ARE the Hanzo sovereign L1: `networkID` and
 *    `evmChainID` are equal for every stock network (36900 / 36962 / 36964 / 1337),
 *    every value env-overridable so an operator can pin the exact deployed id.
 *
 * Values, not places: a network is data. The stock set is Hanzo's; a user running a
 * copy of the cloud binary at home selects `local` (their own deployment + local
 * chain) or adds a `custom` network (its own networkID / evmChainID / RPC / API),
 * persisted so it sticks. Held in module state (mirrored from the provider) so the
 * non-React API client (`lib/api/client.ts`) reads the active API base synchronously.
 */
import { config } from '~/config'
import { getScope } from '~/lib/scope'

const trimSlash = (s: string): string => s.replace(/\/+$/, '')

/** A selectable network — its chain identity + the endpoints it resolves to. */
export type Network = {
  /** Selection key; equals the `X-Environment` string. Stock: mainnet/testnet/devnet/local; custom: a slug. */
  id: string
  /** Human label, e.g. "Mainnet". */
  label: string
  /** Primary networkID. For the Hanzo sovereign L1 this EQUALS `evmChainID`. */
  networkID: number
  /** EVM JSON-RPC chain id (wallet / `eth_chainId`). */
  evmChainID: number
  /** EVM JSON-RPC base — chain reads, wallet add/switch. */
  rpcEndpoint: string
  /** Cloud `/v1` API base. Empty = same-origin (this deployment, via `config.cloudUrl`). */
  apiEndpoint: string
  /** Block-explorer base, or '' when none is published. */
  explorer: string
  /** True for a user-added network (persisted in localStorage, removable). */
  custom?: boolean
}

/** Parse a positive-int env override, falling back to `d`. */
const intEnv = (v: string | undefined, d: number): number => {
  const n = Number(v)
  return Number.isInteger(n) && n > 0 ? n : d
}

// Stock endpoints — every one env-overridable per deploy. RPC is the EVM JSON-RPC;
// the cloud API stays SAME-ORIGIN for the stock tiers (they differ by the
// `X-Environment` header, not by host, which keeps the session cookie first-party).
const HANZO_RPC = trimSlash(process.env.NEXT_PUBLIC_HANZO_RPC_URL ?? 'https://rpc.hanzo.network')
const HANZO_TESTNET_RPC = trimSlash(process.env.NEXT_PUBLIC_HANZO_TESTNET_RPC_URL ?? 'https://rpc.testnet.hanzo.network')
const HANZO_DEVNET_RPC = trimSlash(process.env.NEXT_PUBLIC_HANZO_DEVNET_RPC_URL ?? 'https://rpc.devnet.hanzo.network')
const HANZO_LOCAL_RPC = trimSlash(process.env.NEXT_PUBLIC_HANZO_LOCAL_RPC_URL ?? 'http://localhost:9630/v1/bc/C/rpc')
const HANZO_EXPLORER = trimSlash(process.env.NEXT_PUBLIC_HANZO_EXPLORER_URL ?? 'https://explorer.hanzo.network')
// Local cloud API base — empty = same-origin, i.e. the very cloud binary serving
// this console at home. Override to point a hosted console at a local binary.
const LOCAL_CLOUD_API = trimSlash(process.env.NEXT_PUBLIC_LOCAL_CLOUD_URL ?? '')

// Hanzo sovereign L1 ids (networkID == evmChainID). Mainnet 36900 matches the
// deployed rpc.hanzo.network the wallet already targets; testnet/devnet are the
// canonical genesis ids (36962/36964); local is the 1337 localnet convention.
const MAINNET_ID = intEnv(process.env.NEXT_PUBLIC_HANZO_MAINNET_CHAIN_ID, 36900)
const TESTNET_ID = intEnv(process.env.NEXT_PUBLIC_HANZO_TESTNET_CHAIN_ID, 36962)
const DEVNET_ID = intEnv(process.env.NEXT_PUBLIC_HANZO_DEVNET_CHAIN_ID, 36964)
const LOCAL_ID = intEnv(process.env.NEXT_PUBLIC_HANZO_LOCAL_CHAIN_ID, 1337)

/**
 * The stock networks. The first three ids MATCH `STOCK_ENVIRONMENTS`
 * (mainnet/testnet/devnet) so selecting one re-scopes `X-Environment` exactly as
 * before; `local` is the self-hosted deployment + local chain.
 */
export const STOCK_NETWORKS: readonly Network[] = [
  { id: 'mainnet', label: 'Mainnet', networkID: MAINNET_ID, evmChainID: MAINNET_ID, rpcEndpoint: HANZO_RPC, apiEndpoint: '', explorer: HANZO_EXPLORER },
  { id: 'testnet', label: 'Testnet', networkID: TESTNET_ID, evmChainID: TESTNET_ID, rpcEndpoint: HANZO_TESTNET_RPC, apiEndpoint: '', explorer: '' },
  { id: 'devnet', label: 'Devnet', networkID: DEVNET_ID, evmChainID: DEVNET_ID, rpcEndpoint: HANZO_DEVNET_RPC, apiEndpoint: '', explorer: '' },
  { id: 'local', label: 'Local', networkID: LOCAL_ID, evmChainID: LOCAL_ID, rpcEndpoint: HANZO_LOCAL_RPC, apiEndpoint: LOCAL_CLOUD_API, explorer: '' },
] as const

/** The default network (mainnet) — the fallback when no selection resolves. */
export const DEFAULT_NETWORK: Network = STOCK_NETWORKS[0]

const STOCK_IDS: ReadonlySet<string> = new Set(STOCK_NETWORKS.map((n) => n.id))
/** True when `id` names a stock network (mainnet/testnet/devnet/local). */
export const isStockNetwork = (id: string): boolean => STOCK_IDS.has(id)

// ── Custom networks: registry (module state) + localStorage persistence ──────
// The registry mirrors the provider's custom list so the non-React client resolves
// the active network synchronously; the provider is the writer, this is the store.
const LS_KEY = 'hanzo.console.networks'
let customRegistry: readonly Network[] = []

/** Replace the in-memory custom-network registry (called by the provider). */
export const setCustomRegistry = (nets: readonly Network[]): void => {
  customRegistry = nets
}

/** Stock networks followed by the user's custom ones. */
export const allNetworks = (): Network[] => [...STOCK_NETWORKS, ...customRegistry]

/** Resolve a network by id (stock or custom), or undefined. */
export const networkById = (id: string | undefined): Network | undefined =>
  id ? allNetworks().find((n) => n.id === id) : undefined

/**
 * The active network — the one whose `id` is the active `environment` string.
 * A project-custom environment (a name that is not a network) resolves to the
 * default network's endpoints, so cloud scoping still works with no chain retarget.
 */
export const activeNetwork = (): Network => networkById(getScope().environment) ?? DEFAULT_NETWORK

/**
 * The cloud `/v1` base for the active network: its `apiEndpoint` when set (a custom
 * or relocated deployment), else same-origin (`config.cloudUrl`). This is what
 * points every cloud API call at the selected deployment.
 */
export const activeApiBase = (): string => {
  const n = activeNetwork()
  return n.apiEndpoint || config.cloudUrl
}

/** Slugify a label into a stable, url/header-safe network id. */
export const slugifyNetworkId = (label: string): string =>
  label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

/** A validated custom-network draft from the add form (strings straight off inputs). */
export type CustomNetworkDraft = {
  label: string
  networkID: string
  evmChainID: string
  rpcEndpoint: string
  apiEndpoint: string
}

const isHttpUrl = (s: string): boolean => /^https?:\/\/.+/i.test(s.trim())

/**
 * Validate + normalize a custom-network draft into a `Network`, or return an error
 * string. `evmChainID` defaults to `networkID` (sovereign L1: networkID == chainID).
 * `apiEndpoint` is optional (empty = same-origin). `taken` blocks id collisions.
 */
export const parseCustomNetwork = (
  d: CustomNetworkDraft,
  taken: ReadonlySet<string> = new Set(),
): { network: Network } | { error: string } => {
  const label = d.label.trim()
  if (!label) return { error: 'Name is required.' }
  const id = slugifyNetworkId(label)
  if (!id) return { error: 'Name must contain a letter or number.' }
  if (isStockNetwork(id) || taken.has(id)) return { error: `A network named "${label}" already exists.` }

  const networkID = Number(d.networkID)
  if (!Number.isInteger(networkID) || networkID <= 0) return { error: 'Network ID must be a positive integer.' }

  const chainRaw = d.evmChainID.trim()
  const evmChainID = chainRaw === '' ? networkID : Number(chainRaw)
  if (!Number.isInteger(evmChainID) || evmChainID <= 0) return { error: 'EVM chain ID must be a positive integer.' }

  const rpcEndpoint = d.rpcEndpoint.trim()
  if (!isHttpUrl(rpcEndpoint)) return { error: 'RPC endpoint must be an http(s) URL.' }

  const apiEndpoint = d.apiEndpoint.trim()
  if (apiEndpoint !== '' && !isHttpUrl(apiEndpoint)) return { error: 'API endpoint must be an http(s) URL (or left blank).' }

  return {
    network: {
      id,
      label,
      networkID,
      evmChainID,
      rpcEndpoint: trimSlash(rpcEndpoint),
      apiEndpoint: trimSlash(apiEndpoint),
      explorer: '',
      custom: true,
    },
  }
}

/** True when a value is a well-formed `Network` (used to filter persisted rows). */
const isNetwork = (v: unknown): v is Network => {
  if (!v || typeof v !== 'object') return false
  const n = v as Record<string, unknown>
  return (
    typeof n.id === 'string' &&
    typeof n.label === 'string' &&
    typeof n.networkID === 'number' &&
    typeof n.evmChainID === 'number' &&
    typeof n.rpcEndpoint === 'string' &&
    typeof n.apiEndpoint === 'string'
  )
}

/** Restore the persisted custom networks (marked `custom`); [] when none/unavailable. */
export const loadCustomNetworks = (): Network[] => {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(LS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isNetwork).map((n) => ({ ...n, explorer: n.explorer ?? '', custom: true }))
  } catch {
    return []
  }
}

/** Persist the custom networks. */
export const persistCustomNetworks = (nets: readonly Network[]): void => {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(LS_KEY, JSON.stringify(nets))
  } catch {
    // ignore quota / private-mode failures — the registry still lives in module state
  }
}
