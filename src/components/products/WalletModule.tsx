'use client'

/**
 * Wallet — connect a wallet on Hanzo Mainnet and read your HUSD next to your
 * cloud credit balance.
 *
 * Non-custodial and read-only: the user signs in their OWN wallet
 * (window.ethereum) via `~/lib/wallet/hanzo-evm` (ethers v6), and this page
 * never asks for a signature or moves funds. Paying for credit in crypto is a
 * DEPOSIT, not a send-then-report: billing hands out a deposit address
 * (`POST /v1/billing/crypto/deposit`, with `/v1/billing/crypto/options` for the
 * assets it takes and `/v1/billing/crypto/deposit/{id}` for the state of one)
 * and credits the balance when the chain watcher sees a confirmed transfer, so
 * no client-supplied transaction hash takes part.
 *
 * Honest states only — when no wallet is installed, when HUSD is not yet
 * deployed (greenfield), or when the chain is unreachable, the UI says so. It
 * never shows a fabricated balance or credit.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { Wallet, Coins, CreditCard, RefreshCw, AlertCircle } from '@hanzogui/lucide-icons-2'

import { useCloudBalance, spendableCents, balanceSplitLabel } from '~/lib/billing/live-balance'
import * as evm from '~/lib/wallet/hanzo-evm'
import { PageHeader } from '@hanzo/ui/product'
import { usd } from '~/lib/money'

type Loadable<T> =
  | { state: 'idle' | 'loading' }
  | { state: 'ok'; value: T }
  | { state: 'unconfigured' }
  | { state: 'noauth' }
  | { state: 'error'; error: string }

export function WalletModule(_props: { params: Record<string, string> }) {
  const [conn, setConn] = useState<evm.Connection | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [connectErr, setConnectErr] = useState<string | null>(null)
  const [walletHusd, setWalletHusd] = useState<Loadable<bigint>>({ state: 'idle' })

  // Cloud credit = the ONE shared live balance (same value the sidebar + Cost page
  // show), auto-refreshing on focus/visibility/poll and after a completion.
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

  // ── Mount: already-authorized wallet ────────────────────────────────────────
  useEffect(() => {
    let live = true
    void (async () => {
      const addr = await evm.currentAddress()
      if (!live || !addr) return
      setConn({ address: addr, chainId: evm.HANZO_MAINNET.chainId })
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
      setConnectErr(e instanceof Error ? e.message : 'The wallet was not connected. Nothing was signed — try again, and check the wallet extension is unlocked.')
    } finally {
      setConnecting(false)
    }
  }, [loadWalletHusd])

  const refresh = useCallback(() => {
    refreshCloud()
    void loadWalletHusd(conn?.address ?? null)
  }, [conn, refreshCloud, loadWalletHusd])

  const onHanzo = conn?.chainId === evm.HANZO_MAINNET.chainId

  return (
    <>
      <PageHeader
        title="Wallet"
        subtitle="Connect a wallet on Hanzo Mainnet to see your HUSD next to your cloud credit."
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

      <Card p="$4" gap="$1.5" borderWidth={1} borderColor="$borderColor" bg="$color2">
        <Text fontSize="$3" color="$color11">
          HUSD is the Hanzo USD stablecoin on Hanzo Mainnet (chain {evm.HANZO_MAINNET.chainId}). Your
          cloud credit is the one balance every Hanzo Cloud product spends from — add to it in Hanzo
          Billing, where a crypto payment is made by sending to a deposit address Billing issues you.
        </Text>
      </Card>
    </>
  )
}
