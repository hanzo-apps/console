/**
 * Wallet HUSD top-up — verify on-chain, then record to commerce (server route).
 *
 * Why this lives in console2 and not billing: billing.hanzo.ai is a Next static
 * export (`output: 'export'`) and cannot host a runtime POST handler, and the
 * commerce backend is owned elsewhere. So the verify-and-record seam lives here
 * as a same-origin server route — the same pattern as `app/paas/[...path]`: the
 * browser calls the console's OWN origin, the server does the privileged work,
 * and config comes from server-only env (sourced via KMS, never `NEXT_PUBLIC`).
 *
 * Flow: the client sends an HUSD ERC-20 transfer to the treasury and posts the
 * tx hash here. We read the receipt from the Hanzo EVM, confirm it is a mined,
 * successful HUSD `Transfer(from → treasury, value)`, derive USD cents from the
 * (18-decimal, USD-pegged) value, then record it to commerce as a `husd` crypto
 * payment and return the credited amount + the new balance. The on-chain amount
 * — never a client-supplied number — is what gets credited.
 *
 * Honest failure: if HUSD/treasury are unconfigured (greenfield — HUSD not yet
 * deployed) we return 501 so the UI shows a truthful "coming" state; if the tx
 * is missing/failed/not an HUSD-to-treasury transfer we return 400; if the chain
 * or commerce is unreachable we return 502. Never a fabricated credit.
 */
import { type NextRequest, NextResponse } from 'next/server'
import { ethers } from 'ethers'

import { fetchWithTimeout } from '~/lib/server/fetch-timeout'

export const runtime = 'nodejs'

const RPC_URL = (process.env.HANZO_RPC_URL ?? 'https://rpc.hanzo.network').replace(/\/+$/, '')
const HUSD_ADDRESS = (process.env.HANZO_HUSD_ADDRESS ?? '').trim()
const TREASURY = (process.env.HANZO_HUSD_TREASURY ?? '').trim()
const COMMERCE_URL = (process.env.COMMERCE_URL ?? 'https://api.hanzo.ai').replace(/\/+$/, '')
const CHAIN_ID = Number(process.env.HANZO_CHAIN_ID ?? '36900')

const ERC20_TRANSFER_ABI = ['event Transfer(address indexed from, address indexed to, uint256 value)']
const isAddr = (a: string): boolean => /^0x[0-9a-fA-F]{40}$/.test(a)

/** Forward the caller's identity (session cookie / bearer) to commerce. */
function authHeaders(req: NextRequest): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' }
  const cookie = req.headers.get('cookie')
  if (cookie) h.Cookie = cookie
  const auth = req.headers.get('authorization')
  if (auth) h.Authorization = auth
  return h
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  // Greenfield gate: no HUSD contract / treasury ⇒ honest "not configured".
  if (!isAddr(HUSD_ADDRESS) || !isAddr(TREASURY)) {
    return NextResponse.json(
      { error: 'HUSD top-up is not configured yet (HUSD is not deployed on Hanzo Mainnet).' },
      { status: 501 },
    )
  }

  let body: { txHash?: string; fromAddress?: string; userId?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const txHash = (body.txHash ?? '').trim()
  const fromAddress = (body.fromAddress ?? '').trim()
  if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
    return NextResponse.json({ error: 'A valid transaction hash is required.' }, { status: 400 })
  }

  // ── 1. Verify the HUSD transfer on-chain ────────────────────────────────────
  let creditedCents: number
  let verifiedFrom: string
  try {
    const provider = new ethers.JsonRpcProvider(RPC_URL, CHAIN_ID)
    const receipt = await provider.getTransactionReceipt(txHash)
    if (!receipt) {
      return NextResponse.json({ error: 'Transaction not found or not yet mined.' }, { status: 400 })
    }
    if (receipt.status !== 1) {
      return NextResponse.json({ error: 'Transaction failed on-chain.' }, { status: 400 })
    }

    const iface = new ethers.Interface(ERC20_TRANSFER_ABI)
    const husd = HUSD_ADDRESS.toLowerCase()
    const treasury = TREASURY.toLowerCase()
    let value: bigint | null = null
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== husd) continue
      let parsed: ethers.LogDescription | null = null
      try {
        parsed = iface.parseLog({ topics: [...log.topics], data: log.data })
      } catch {
        continue
      }
      if (parsed?.name !== 'Transfer') continue
      if (String(parsed.args.to).toLowerCase() !== treasury) continue
      value = parsed.args.value as bigint
      verifiedFrom = ethers.getAddress(String(parsed.args.from))
      break
    }
    if (value === null) {
      return NextResponse.json(
        { error: 'No HUSD transfer to the treasury was found in this transaction.' },
        { status: 400 },
      )
    }
    if (fromAddress && isAddr(fromAddress) && verifiedFrom!.toLowerCase() !== fromAddress.toLowerCase()) {
      return NextResponse.json({ error: 'Transfer sender does not match the connected wallet.' }, { status: 400 })
    }
    // HUSD is an 18-decimal, USD-pegged stablecoin → 1e16 base units = 1 cent.
    creditedCents = Number(value / 10n ** 16n)
    if (creditedCents <= 0) {
      return NextResponse.json({ error: 'Transferred amount is below the minimum (1 cent).' }, { status: 400 })
    }
  } catch (e) {
    return NextResponse.json(
      { error: `Could not verify the transaction on Hanzo Mainnet: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 },
    )
  }

  // ── 2. Record to commerce as an HUSD crypto payment ─────────────────────────
  try {
    const recordRes = await fetchWithTimeout(`${COMMERCE_URL}/v1/billing/payment`, {
      method: 'POST',
      headers: authHeaders(req),
      cache: 'no-store',
      body: JSON.stringify({
        method: 'crypto',
        network: 'hanzo',
        chainId: CHAIN_ID,
        currency: 'husd',
        amount: creditedCents,
        txHash,
        fromAddress: verifiedFrom!,
        toAddress: TREASURY,
        userId: body.userId,
      }),
    })
    if (!recordRes.ok) {
      const text = await recordRes.text().catch(() => '')
      return NextResponse.json(
        { error: `Commerce rejected the payment (HTTP ${recordRes.status}): ${text}`.trim() },
        { status: 502 },
      )
    }
    const payment = (await recordRes.json().catch(() => ({}))) as { status?: string }

    // New balance (USD ledger) — best-effort; the credit already landed.
    let balance = 0
    try {
      const balRes = await fetchWithTimeout(
        `${COMMERCE_URL}/v1/billing/balance?user=${encodeURIComponent(body.userId ?? '')}&currency=usd`,
        { headers: authHeaders(req), cache: 'no-store' },
      )
      if (balRes.ok) balance = ((await balRes.json()) as { balance?: number }).balance ?? 0
    } catch {
      /* balance is informational; the credit is recorded */
    }

    return NextResponse.json({ creditedCents, balance, txHash, status: payment.status ?? 'recorded' })
  } catch (e) {
    return NextResponse.json(
      { error: `Could not reach commerce to record the payment: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 },
    )
  }
}
