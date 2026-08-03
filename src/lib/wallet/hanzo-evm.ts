/**
 * Hanzo EVM wallet utilities — connect an injected wallet, read HUSD, send HUSD.
 *
 * One canonical definition of the Hanzo Mainnet network + the HUSD stablecoin for
 * the console, built on `ethers` v6 over the browser's EIP-1193 provider
 * (`window.ethereum`). This is NON-custodial: we never create or hold keys — the
 * user signs in their own wallet (MetaMask/Rabby/etc.). That is the correct model
 * for a cloud console (the mnemonic store in `@hanzo/ai` is a Tauri desktop
 * surface, not importable or appropriate here).
 *
 * Network values mirror the canonical `@hanzo/ai` wallet store (chainId 36963,
 * rpc.hanzo.network); the RPC is env-overridable because the Hanzo L1 EVM RPC
 * path is still settling (the node's default C-Chain currently answers a
 * different id at /v1/bc/C/rpc). HUSD is a Hanzo-USD ERC-20 — its address is
 * PUBLIC on-chain data, supplied via `NEXT_PUBLIC_HANZO_HUSD_ADDRESS`. When that
 * is empty (greenfield: HUSD not yet deployed) the UI shows an honest "coming"
 * state and never fabricates a balance.
 */
import { ethers } from 'ethers'

import { STOCK_NETWORKS } from '~/lib/network'

/** Mainnet identity (chain id + RPC + explorer) — the ONE source is the network model. */
const MAINNET = STOCK_NETWORKS[0]

/** Hanzo Mainnet — canonical network descriptor (values from `@hanzo/ai`). */
export const HANZO_MAINNET = {
  chainId: MAINNET.evmChainID,
  /** The EIP-3085/3326 hex form used by wallet_switch/addEthereumChain (e.g. `0x9063`). */
  chainIdHex: `0x${MAINNET.evmChainID.toString(16)}`,
  name: 'Hanzo Mainnet',
  rpcUrl: MAINNET.rpcEndpoint,
  blockExplorer: MAINNET.explorer,
  nativeCurrency: { name: 'AI Token', symbol: 'AI', decimals: 18 },
} as const

/** HUSD = Hanzo USD stablecoin (ERC-20). Addresses are public; empty ⇒ not yet deployed. */
export const HUSD = {
  address: (process.env.NEXT_PUBLIC_HANZO_HUSD_ADDRESS ?? '').trim(),
  /** Treasury that receives top-up transfers (public deposit address). */
  treasury: (process.env.NEXT_PUBLIC_HANZO_HUSD_TREASURY ?? '').trim(),
  symbol: 'HUSD',
  /** USD-pegged 18-decimal stablecoin (1 HUSD = $1). */
  decimals: 18,
} as const

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/

/** True when an HUSD ERC-20 address is configured (i.e. HUSD is deployed). */
export const husdConfigured = (): boolean => ADDR_RE.test(HUSD.address)

/** True when both HUSD and a treasury are set, so top-ups can be sent + recorded. */
export const topupConfigured = (): boolean => husdConfigured() && ADDR_RE.test(HUSD.treasury)

/** Minimal ERC-20 surface — balance + transfer + metadata. */
export const ERC20_ABI = [
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
  'function transfer(address to, uint256 value) returns (bool)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
] as const

/** Injected EIP-1193 provider, if a wallet extension is present. */
function injected(): ethers.Eip1193Provider | null {
  if (typeof window === 'undefined') return null
  const eth = (window as unknown as { ethereum?: ethers.Eip1193Provider }).ethereum
  return eth ?? null
}

/** True when a browser wallet (window.ethereum) is available to connect. */
export const walletAvailable = (): boolean => injected() !== null

/** Human HUSD string from base units (18 decimals). */
export const formatHusd = (value: bigint): string => ethers.formatUnits(value, HUSD.decimals)

/** Base units (18 decimals) from a human HUSD string. Throws on a bad amount. */
export const parseHusd = (amount: string): bigint => ethers.parseUnits(amount.trim(), HUSD.decimals)

/**
 * Ensure the wallet is on Hanzo Mainnet (36963), adding the network if unknown.
 * No-op when already on the chain. Surfaces the wallet's own error otherwise.
 */
export async function ensureHanzoNetwork(eth: ethers.Eip1193Provider): Promise<void> {
  try {
    await eth.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: HANZO_MAINNET.chainIdHex }] })
  } catch (e) {
    // 4902 = chain not added to the wallet → add it, then it's selected.
    const code = (e as { code?: number })?.code
    if (code === 4902 || code === -32603) {
      await eth.request({
        method: 'wallet_addEthereumChain',
        params: [
          {
            chainId: HANZO_MAINNET.chainIdHex,
            chainName: HANZO_MAINNET.name,
            rpcUrls: [HANZO_MAINNET.rpcUrl],
            blockExplorerUrls: [HANZO_MAINNET.blockExplorer],
            nativeCurrency: HANZO_MAINNET.nativeCurrency,
          },
        ],
      })
      return
    }
    throw e
  }
}

export type Connection = { address: string; chainId: number }

/**
 * Connect the injected wallet and select Hanzo Mainnet. Returns the active
 * address + chainId. Throws a clear error when no wallet is installed.
 */
export async function connect(): Promise<Connection> {
  const eth = injected()
  if (!eth) throw new Error('No browser wallet detected. Install MetaMask or a compatible wallet.')
  const provider = new ethers.BrowserProvider(eth)
  const accounts = (await eth.request({ method: 'eth_requestAccounts' })) as string[]
  if (!accounts?.length) throw new Error('No accounts authorized.')
  await ensureHanzoNetwork(eth)
  const net = await provider.getNetwork()
  return { address: ethers.getAddress(accounts[0]), chainId: Number(net.chainId) }
}

/** Currently-authorized address without prompting, or null. */
export async function currentAddress(): Promise<string | null> {
  const eth = injected()
  if (!eth) return null
  try {
    const accounts = (await eth.request({ method: 'eth_accounts' })) as string[]
    return accounts?.length ? ethers.getAddress(accounts[0]) : null
  } catch {
    return null
  }
}

/**
 * Read an address's HUSD balance (base units). Throws when HUSD is unconfigured
 * (caller shows the honest not-live state) or the network is unreachable.
 */
export async function readHusdBalance(address: string): Promise<bigint> {
  if (!husdConfigured()) throw new Error('HUSD is not live on Hanzo Mainnet.')
  const eth = injected()
  // Prefer the wallet's provider (it holds the working Hanzo RPC); fall back to
  // the configured public RPC for read-only.
  const provider = eth ? new ethers.BrowserProvider(eth) : new ethers.JsonRpcProvider(HANZO_MAINNET.rpcUrl)
  const husd = new ethers.Contract(HUSD.address, ERC20_ABI, provider)
  return (await husd.balanceOf(ethers.getAddress(address))) as bigint
}

/**
 * Send HUSD from the connected wallet to `to`. Returns the transaction hash once
 * accepted by the wallet (not yet mined). Throws when HUSD is unconfigured.
 */
export async function sendHusd(to: string, amount: string): Promise<string> {
  if (!husdConfigured()) throw new Error('HUSD is not live on Hanzo Mainnet.')
  const eth = injected()
  if (!eth) throw new Error('No browser wallet detected.')
  await ensureHanzoNetwork(eth)
  const provider = new ethers.BrowserProvider(eth)
  const signer = await provider.getSigner()
  const husd = new ethers.Contract(HUSD.address, ERC20_ABI, signer)
  const tx = await husd.transfer(ethers.getAddress(to), parseHusd(amount))
  return tx.hash as string
}

/** Send an HUSD top-up to the configured treasury. Returns the tx hash. */
export async function sendHusdTopup(amount: string): Promise<string> {
  if (!topupConfigured()) throw new Error('HUSD top-up is not available yet on Hanzo Mainnet.')
  return sendHusd(HUSD.treasury, amount)
}

/** Block-explorer URL for a transaction hash. */
export const txUrl = (hash: string): string => `${HANZO_MAINNET.blockExplorer}/tx/${hash}`

/** Shorten an address for display (0x1234…abcd). */
export const shortAddr = (a: string): string => (a.length > 10 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a)
