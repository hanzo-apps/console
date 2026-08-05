'use client'

/**
 * Wallet & HUSD Top-up — connect a wallet on Hanzo Mainnet, see your HUSD and
 * cloud credit balances, and top up credit by sending HUSD.
 *
 * Non-custodial: the user signs in their OWN wallet (window.ethereum) via
 * `~/lib/wallet/hanzo-evm` (ethers v6). The send → record → credit flow is:
 * send HUSD to the treasury, POST the tx to the console's verify-and-record
 * endpoint (`/billing/topup/wallet`), which checks the transfer on-chain and
 * records it to commerce as a `husd` crypto payment.
 *
 * Honest states only — when no wallet is installed, when HUSD is not yet
 * deployed (greenfield), when the chain is unreachable, or when the endpoint is
 * unconfigured, the UI says so. It never shows a fabricated balance or credit.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Input, Text, XStack, YStack } from '@hanzo/gui'
import {
  Wallet,
  Coins,
  CreditCard,
  RefreshCw,
  ArrowUpRight,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
} from '@hanzogui/lucide-icons-2'

import { AccountApi, type Account } from '~/lib/api'
import { WalletApi } from '~/lib/api/wallet'
import { useCloudBalance, invalidateBalance, spendableCents, balanceSplitLabel } from '~/lib/billing/live-balance'
import * as evm from '~/lib/wallet/hanzo-evm'
import { PageHeader } from '@hanzo/ui/product'

const usd = (cents: number): string => `$${(cents / 100).toFixed(2)}`
const userIdOf = (a: Account | null): string | undefined => a?.email ?? a?.name ?? undefined

type Loadable<T> =
  | { state: 'idle' | 'loading' }
  | { state: 'ok'; value: T }
  | { state: 'unconfigured' }
  | { state: 'noauth' }
  | { state: 'error'; error: string }

type Topup =
  | { state: 'idle' }
  | { state: 'sending' }
  | { state: 'recording' }
  | { state: 'success'; txHash: string; creditedCents: number }
  | { state: 'error'; error: string }

export function WalletModule(_props: { params: Record<string, string> }) {
  const [account, setAccount] = useState<Account | null>(null)
  const [conn, setConn] = useState<evm.Connection | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [connectErr, setConnectErr] = useState<string | null>(null)
  const [walletHusd, setWalletHusd] = useState<Loadable<bigint>>({ state: 'idle' })
  const [amount, setAmount] = useState('')
  const [topup, setTopup] = useState<Topup>({ state: 'idle' })

  // Cloud credit = the ONE shared live balance (same value the sidebar + Cost page
  // show), auto-refreshing on focus/visibility/poll and after a completion/top-up.
  const { phase: cloudPhase, balance: cloudBalance, error: cloudError, refresh: refreshCloud } = useCloudBalance()
  const cloudCents = spendableCents(cloudBalance)

  const walletReady = typeof window !== 'undefined' && evm.walletAvailable()

  // ── Loaders ────────────────────────────────────────────────────────────────
  const loadWalletHusd = useCallback(async (address: string | null) => {
    if (!address) {
      setWalletHusd({ state: 'idle' })
      return
    }
    if (!evm.husdConfigured()) {
      setWalletHusd({ state: 'unconfigured' })
      return
    }
    setWalletHusd({ state: 'loading' })
    try {
      const value = await evm.readHusdBalance(address)
      setWalletHusd({ state: 'ok', value })
    } catch (e) {
      setWalletHusd({ state: 'error', error: e instanceof Error ? e.message : 'Balance unavailable' })
    }
  }, [])

  // ── Mount: account + already-authorized wallet ──────────────────────────────
  useEffect(() => {
    let live = true
    void (async () => {
      const acc = await AccountApi.current()
      if (!live) return
      setAccount(acc)
      const addr = await evm.currentAddress()
      if (!live || !addr) return
      const c = { address: addr, chainId: evm.HANZO_MAINNET.chainId }
      setConn(c)
      void loadWalletHusd(addr)
    })()
    return () => {
      live = false
    }
  }, [loadWalletHusd])

  // ── Actions ─────────────────────────────────────────────────────────────────
  const onConnect = useCallback(async () => {
    setConnecting(true)
    setConnectErr(null)
    try {
      const c = await evm.connect()
      setConn(c)
      void loadWalletHusd(c.address)
    } catch (e) {
      setConnectErr(e instanceof Error ? e.message : 'Failed to connect wallet')
    } finally {
      setConnecting(false)
    }
  }, [loadWalletHusd])

  const onTopup = useCallback(async () => {
    if (!conn) return
    const n = Number.parseFloat(amount)
    if (!Number.isFinite(n) || n <= 0) {
      setTopup({ state: 'error', error: 'Enter an amount greater than zero.' })
      return
    }
    setTopup({ state: 'sending' })
    try {
      const txHash = await evm.sendHusdTopup(amount)
      setTopup({ state: 'recording' })
      const result = await WalletApi.recordWalletTopup({
        txHash,
        fromAddress: conn.address,
        userId: userIdOf(account),
      })
      setTopup({ state: 'success', txHash: result.txHash, creditedCents: result.creditedCents })
      setAmount('')
      invalidateBalance() // credit landed — reflect it in the cloud-credit card now
      void loadWalletHusd(conn.address)
    } catch (e) {
      setTopup({ state: 'error', error: e instanceof Error ? e.message : 'Top-up failed' })
    }
  }, [conn, amount, account, loadWalletHusd])

  const refresh = useCallback(() => {
    refreshCloud()
    void loadWalletHusd(conn?.address ?? null)
  }, [conn, refreshCloud, loadWalletHusd])

  const busy = topup.state === 'sending' || topup.state === 'recording'
  const onHanzo = conn?.chainId === evm.HANZO_MAINNET.chainId

  return (
    <>
      <PageHeader
        title="Wallet & HUSD Top-up"
        subtitle="Connect a wallet on Hanzo Mainnet to view balances and top up cloud credit with HUSD."
        actions={
          <Button icon={<RefreshCw size={16} />} onPress={refresh}>
            Refresh
          </Button>
        }
      />

      <XStack flexWrap="wrap" gap="$3">
        {/* ── Cloud credit balance ─────────────────────────────────────────── */}
        <Card p="$4" gap="$2" borderWidth={1} borderColor="$borderColor" width={320}>
          <XStack items="center" gap="$2">
            <CreditCard size={16} />
            <Text fontSize="$5" fontWeight="700">
              Cloud credit
            </Text>
          </XStack>
          {cloudPhase === 'ready' && cloudBalance ? (
            <YStack gap="$1">
              <Text fontSize="$9" fontWeight="900">
                {usd(cloudCents ?? cloudBalance.available)}
              </Text>
              {/* Distinct trial (non-cash) + prepaid (real money) split, when reported. */}
              {balanceSplitLabel(cloudBalance) ? (
                <Text fontSize="$2" color="$color12">{balanceSplitLabel(cloudBalance)}</Text>
              ) : null}
              <Text fontSize="$2" color="$color11">
                available · {usd(cloudBalance.balance)} total · {usd(cloudBalance.holds)} on hold
              </Text>
            </YStack>
          ) : cloudPhase === 'noauth' ? (
            <Text fontSize="$3" color="$color11">
              Sign in to view your cloud credit balance.
            </Text>
          ) : cloudPhase === 'unconfigured' ? (
            <Text fontSize="$3" color="$color11">
              Cloud credit balance isn&apos;t available on this deployment yet. Manage billing in
              Hanzo Billing.
            </Text>
          ) : cloudPhase === 'error' ? (
            <Text fontSize="$3" color="$color11">
              Balance unavailable: {cloudError}
            </Text>
          ) : (
            <Text fontSize="$3" color="$color11">
              Loading…
            </Text>
          )}
        </Card>

        {/* ── Wallet HUSD balance ──────────────────────────────────────────── */}
        <Card p="$4" gap="$2" borderWidth={1} borderColor="$borderColor" width={320}>
          <XStack items="center" gap="$2">
            <Coins size={16} />
            <Text fontSize="$5" fontWeight="700">
              Wallet HUSD
            </Text>
          </XStack>
          {!walletReady ? (
            <Text fontSize="$3" color="$color11">
              No browser wallet detected. Install MetaMask or a compatible wallet to continue.
            </Text>
          ) : !conn ? (
            <YStack gap="$2">
              <Text fontSize="$3" color="$color11">
                Connect your wallet to view your HUSD balance.
              </Text>
              <Button theme="light" icon={<Wallet size={16} />} onPress={onConnect} disabled={connecting}>
                {connecting ? 'Connecting…' : 'Connect Wallet'}
              </Button>
              {connectErr ? (
                <Text fontSize="$2" color="$color11">
                  {connectErr}
                </Text>
              ) : null}
            </YStack>
          ) : (
            <YStack gap="$1.5">
              {walletHusd.state === 'ok' ? (
                <Text fontSize="$9" fontWeight="900">
                  {evm.formatHusd(walletHusd.value)} {evm.HUSD.symbol}
                </Text>
              ) : walletHusd.state === 'unconfigured' ? (
                <Text fontSize="$3" color="$color11">
                  HUSD is coming to Hanzo Mainnet. Balances appear once the token is live.
                </Text>
              ) : walletHusd.state === 'error' ? (
                <Text fontSize="$3" color="$color11">
                  Balance unavailable: {walletHusd.error}
                </Text>
              ) : (
                <Text fontSize="$3" color="$color11">
                  Loading…
                </Text>
              )}
              <XStack items="center" gap="$2">
                <Text fontSize="$2" color="$color10">
                  {evm.shortAddr(conn.address)}
                </Text>
                {!onHanzo ? (
                  <XStack bg="$color4" px="$2" py="$1" rounded="$10" items="center" gap="$1">
                    <AlertCircle size={11} />
                    <Text fontSize="$1" color="$color11">
                      Switch to Hanzo Mainnet
                    </Text>
                  </XStack>
                ) : (
                  <Text fontSize="$1" color="$color10">
                    · Hanzo Mainnet
                  </Text>
                )}
              </XStack>
            </YStack>
          )}
        </Card>
      </XStack>

      {/* ── Top-up ──────────────────────────────────────────────────────────── */}
      <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor">
        <XStack items="center" gap="$2">
          <ArrowUpRight size={16} />
          <Text fontSize="$5" fontWeight="700">
            Top up with HUSD
          </Text>
        </XStack>

        {!evm.topupConfigured() ? (
          <YStack gap="$3" maxW={460}>
            <Text fontSize="$3" color="$color11">
              On-chain HUSD top-up runs once HUSD is live on Hanzo Mainnet — your HUSD balance already shows
              above when a wallet is connected. To add cloud credit today, top up with a card on Billing.
            </Text>
            <XStack>
              <Button
                theme="light"
                icon={<CreditCard size={15} />}
                onPress={() => { if (typeof window !== 'undefined') window.location.assign('/billing') }}
              >
                Add credit on Billing
              </Button>
            </XStack>
          </YStack>
        ) : !conn ? (
          <Text fontSize="$3" color="$color11">
            Connect your wallet above to top up.
          </Text>
        ) : (
          <YStack gap="$3" maxW={420}>
            <Text fontSize="$3" color="$color11">
              Send HUSD to your cloud credit. 1 HUSD = $1.00 credit.
            </Text>
            <XStack gap="$2" items="center">
              <Input
                flex={1}
                value={amount}
                onChangeText={setAmount}
                placeholder="Amount in HUSD"
                disabled={busy}
              />
              <Button theme="light" onPress={onTopup} disabled={busy || !amount}>
                {topup.state === 'sending'
                  ? 'Confirm in wallet…'
                  : topup.state === 'recording'
                    ? 'Crediting…'
                    : 'Top up'}
              </Button>
            </XStack>

            {topup.state === 'success' ? (
              <XStack items="center" gap="$2">
                <CheckCircle2 size={16} />
                <Text fontSize="$3" color="$color11">
                  Credited {usd(topup.creditedCents)}.
                </Text>
                <Button
                  size="$2"
                  chromeless
                  icon={<ExternalLink size={13} />}
                  onPress={() => window.open(evm.txUrl(topup.txHash), '_blank', 'noopener')}
                >
                  View transaction
                </Button>
              </XStack>
            ) : topup.state === 'error' ? (
              <XStack items="center" gap="$2">
                <AlertCircle size={16} />
                <Text fontSize="$3" color="$color11">
                  {topup.error}
                </Text>
              </XStack>
            ) : null}
          </YStack>
        )}
      </Card>

      <Card p="$4" gap="$1.5" borderWidth={1} borderColor="$borderColor" bg="$color2">
        <Text fontSize="$3" color="$color11">
          HUSD is the Hanzo USD stablecoin on Hanzo Mainnet (chain {evm.HANZO_MAINNET.chainId}). Top-ups
          are verified on-chain and credited to the same balance used across every Hanzo Cloud product.
        </Text>
      </Card>
    </>
  )
}
