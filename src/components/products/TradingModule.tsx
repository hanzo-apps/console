'use client'

/**
 * Trading — deploy and manage the Lux DEX trading bots (the market-maker + trader)
 * as native cloud apps. This is the console surface for the bots: it LISTS the org's
 * deployed bots, shows each one's LIVE state (the markets it's making, its
 * per-symbol quote quality + service counters from the maker's :2112 metrics, and
 * the DEX order book for its pairs), and CONTROLS them (deploy from a config form →
 * the PaaS BuildKit, start/stop, reconfigure/redeploy, and logs).
 *
 * DRY + one way: the fleet + the lifecycle controls are the SAME PaaS control plane
 * (`PaasApi` → `/v1` bearer proxy → cloud `/v1/platform/*`) the Compute ›
 * Applications page uses — the bots are ordinary PaaS git apps. The live STATE
 * (maker metrics + the DEX book) is read through console2's own session-gated,
 * brand-scoped `/trading` proxy. Honest states everywhere: a bot with no metrics
 * endpoint, an unreachable maker, or an unreachable DEX each show an honest note —
 * never fabricated quotes or a fake order book.
 *
 * Routes: `''` = the fleet; `':name'` = a bot detail (`deploy:<templateId>` opens
 * the deploy form for that template).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { DataTable, type FieldDefinition } from '@hanzo/data'

import { PaasApi } from '~/lib/api/paas'
import {
  TradingApi,
  fmtBps,
  fmtBurn,
  fmtCount,
  fmtUptime,
  type BotInstance,
  type MakerStatus,
  type OrderBook,
} from '~/lib/api/trading'
import type { NodeNetworkId } from '~/lib/products/brand-scope'
import { BOT_TEMPLATES, findBotTemplate } from '~/lib/products/trading/templates'
import { botsFromApps, isBotRunning, networkLabel, summarizeFleet } from '~/components/products/trading/logic'
import { DeployForm } from '~/components/products/trading/DeployForm'
import { findEntry } from '~/lib/products/registry'
import { BackendStateCard, EmptyState, PageHeader, PrimaryButton, StatusTag, classifyBackend, type BackendState } from '@hanzo/ui/product'

/** Columns for the bot fleet table. */
const FLEET_FIELDS: FieldDefinition[] = [
  { name: 'name', label: 'Bot', type: 'text', width: 200 },
  { name: 'kind', label: 'Type', type: 'text', width: 130 },
  { name: 'network', label: 'Network', type: 'text', width: 130 },
  { name: 'status', label: 'Status', type: 'text', width: 120 },
  { name: 'tag', label: 'Version', type: 'text', width: 160 },
]

/** Columns for the per-symbol quote table (from the maker metrics). */
const SYMBOL_FIELDS: FieldDefinition[] = [
  { name: 'symbol', label: 'Market', type: 'text', width: 140 },
  { name: 'peg', label: 'Peg error', type: 'text', width: 120 },
  { name: 'p50', label: 'p50', type: 'text', width: 100 },
  { name: 'p99', label: 'p99', type: 'text', width: 100 },
  { name: 'realized', label: 'Realized', type: 'text', width: 120 },
]

/** Columns for the DEX order-book table. */
const BOOK_FIELDS: FieldDefinition[] = [
  { name: 'orderId', label: 'Order ID', type: 'text', width: 160 },
  { name: 'user', label: 'Account', type: 'text', width: 360 },
]

/** A KPI tile. */
function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <YStack minW={120}>
      <Text fontSize="$1" color="$color10">{label}</Text>
      <Text fontSize="$6" fontWeight="800">{value}</Text>
    </YStack>
  )
}

/** The live maker status card — service counters + per-symbol quote quality. */
function MakerStatusCard({ status, loading }: { status: MakerStatus | null; loading: boolean }) {
  if (loading) {
    return (
      <Card borderWidth={1} borderColor="$borderColor" p="$3">
        <Text fontSize="$2" color="$color10">Reading live metrics…</Text>
      </Card>
    )
  }
  if (!status || status.status === 'not-reporting') {
    return (
      <Card borderWidth={1} borderColor="$borderColor" p="$3" gap="$2">
        <XStack gap="$2" items="center">
          <StatusTag status="down" />
          <Text fontSize="$3" fontWeight="700">Metrics not reporting</Text>
        </XStack>
        <Text fontSize="$2" color="$color10">
          The maker’s :2112 metrics did not answer{status?.error ? ` — ${status.error}` : ''}. Quote quality fills in
          once the maker is reachable.
        </Text>
      </Card>
    )
  }
  const symbolRows = status.symbols.map((s) => ({
    symbol: s.symbol,
    peg: fmtBps(s.pegErrorBps),
    p50: fmtBps(s.pegP50Bps),
    p99: fmtBps(s.pegP99Bps),
    realized: fmtBps(s.realizedErrorBps),
  }))
  return (
    <YStack gap="$3">
      <Card borderWidth={1} borderColor="$borderColor" p="$3" gap="$3">
        <XStack gap="$2" items="center">
          <StatusTag status="active" />
          <Text fontSize="$3" fontWeight="700">Live · pegging {status.symbols.length} market(s)</Text>
        </XStack>
        <XStack gap="$4" flexWrap="wrap">
          <Kpi label="Uptime" value={fmtUptime(status.uptimeSeconds)} />
          <Kpi label="Requotes" value={fmtCount(status.requotes)} />
          <Kpi label="Arbs" value={fmtCount(status.arbs)} />
          <Kpi label="Fills" value={fmtCount(status.fills)} />
          <Kpi label="Errors" value={fmtCount(status.errors)} />
          <Kpi label="Burn" value={fmtBurn(status.burnLux)} />
        </XStack>
      </Card>
      <YStack gap="$2">
        <Text fontSize="$5" fontWeight="700">Quotes</Text>
        <Text fontSize="$2" color="$color10">
          Per-market peg error — how tightly the book mid tracks the reference (the maker’s income is the spread, not this error).
        </Text>
        <DataTable fields={SYMBOL_FIELDS} records={symbolRows} empty="No markets reported. A row appears per market this maker quotes, with its peg error, once it starts pegging." />
      </YStack>
    </YStack>
  )
}

/** The DEX order-book card for a market. */
function OrderBookCard({ book, loading }: { book: OrderBook | null; loading: boolean }) {
  if (loading) {
    return (
      <Card borderWidth={1} borderColor="$borderColor" p="$3">
        <Text fontSize="$2" color="$color10">Reading the order book…</Text>
      </Card>
    )
  }
  if (!book || book.status === 'not-reporting') {
    return (
      <Card borderWidth={1} borderColor="$borderColor" p="$3" gap="$2">
        <XStack gap="$2" items="center">
          <StatusTag status="neutral" />
          <Text fontSize="$3" fontWeight="700">Order book not reporting</Text>
        </XStack>
        <Text fontSize="$2" color="$color10">
          The DEX did not answer{book?.error ? ` — ${book.error}` : ''}. The native D-Chain CLOB is an in-cluster surface;
          the book renders here once it is reachable.
        </Text>
      </Card>
    )
  }
  const rows = book.orders.map((o) => ({ orderId: o.orderId.toLocaleString(), user: o.user || '—' }))
  return (
    <YStack gap="$2">
      <Text fontSize="$5" fontWeight="700">Order book</Text>
      <Text fontSize="$2" color="$color10">
        Resting orders on the DEX book{book.symbol ? ` for ${book.symbol}` : ''} (live from the D-Chain CLOB).
      </Text>
      <DataTable fields={BOOK_FIELDS} records={rows} empty="No resting orders on this book. Open orders appear here as they land on the DEX book for this market." />
    </YStack>
  )
}

/** The detail view for one deployed bot: status + order book + controls. */
function BotDetail({ bot, onBack, onChanged }: { bot: BotInstance; onBack: () => void; onChanged: () => void }) {
  const [status, setStatus] = useState<MakerStatus | null>(null)
  const [book, setBook] = useState<OrderBook | null>(null)
  const [loadingStatus, setLoadingStatus] = useState(bot.template === 'market-maker')
  const [loadingBook, setLoadingBook] = useState(false)
  const [logs, setLogs] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const network = (bot.network ?? 'lux-testnet') as NodeNetworkId
  const running = isBotRunning(bot)

  const loadStatus = useCallback(async () => {
    if (bot.template !== 'market-maker') return
    setLoadingStatus(true)
    try {
      setStatus(await TradingApi.makerStatus(network, bot.slug))
    } catch {
      setStatus({ status: 'not-reporting', symbols: [] })
    } finally {
      setLoadingStatus(false)
    }
  }, [bot.template, bot.slug, network])

  useEffect(() => { loadStatus() }, [loadStatus])

  const loadBook = useCallback(async (symbol: string) => {
    setLoadingBook(true)
    try {
      setBook(await TradingApi.orderbook(network, { symbol }))
    } catch {
      setBook({ network, symbol, status: 'not-reporting', orders: [] })
    } finally {
      setLoadingBook(false)
    }
  }, [network])

  const control = useCallback(
    async (op: 'start' | 'stop' | 'redeploy') => {
      setBusy(true)
      setErr(null)
      try {
        if (op === 'start') await PaasApi.start(bot.project, bot.slug)
        else if (op === 'stop') await PaasApi.stop(bot.project, bot.slug)
        else await PaasApi.deploy(bot.project, bot.slug, {})
        onChanged()
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(false)
      }
    },
    [bot.project, bot.slug, onChanged],
  )

  const loadLogs = useCallback(async () => {
    setErr(null)
    try {
      const deployments = await PaasApi.listDeployments(bot.project, bot.slug)
      const latest = deployments[0]
      if (!latest) {
        setLogs('No deployments yet.')
        return
      }
      setLogs((await PaasApi.deploymentLogs(bot.project, bot.slug, latest.id)) || 'No logs for the latest deployment.')
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }, [bot.project, bot.slug])

  const template = findBotTemplate(bot.template)

  return (
    <YStack gap="$4">
      <PageHeader
        title={bot.name}
        subtitle={`${template?.label ?? bot.template} · ${networkLabel(bot.network)} · ${bot.image}${bot.tag ? `:${bot.tag}` : ''}`}
        actions={
          <XStack gap="$2" flexWrap="wrap">
            <Button size="$3" onPress={onBack}>Back</Button>
            <Button size="$3" onPress={loadStatus} disabled={loadingStatus}>Refresh</Button>
          </XStack>
        }
      />

      <XStack gap="$3" flexWrap="wrap" items="center">
        <StatusTag status={bot.health || bot.status} />
        {running ? (
          <Button size="$3" theme="red" onPress={() => control('stop')} disabled={busy}>Stop</Button>
        ) : (
          <PrimaryButton size="$3" onPress={() => control('start')} disabled={busy}>Start</PrimaryButton>
        )}
        <Button size="$3" onPress={() => control('redeploy')} disabled={busy}>Redeploy</Button>
        <Button size="$3" onPress={loadLogs} disabled={busy}>Logs</Button>
      </XStack>

      {err ? (
        <Card bg="$red3" borderColor="$red7" borderWidth={1} p="$3">
          <Text fontSize="$2" color="$red11">{err}</Text>
        </Card>
      ) : null}

      {bot.template === 'market-maker' ? (
        <MakerStatusCard status={status} loading={loadingStatus} />
      ) : (
        <Card borderWidth={1} borderColor="$borderColor" p="$3" gap="$2">
          <XStack gap="$2" items="center">
            <StatusTag status={bot.health || bot.status} />
            <Text fontSize="$3" fontWeight="700">Trader — no metrics endpoint</Text>
          </XStack>
          <Text fontSize="$2" color="$color10">
            The trader is a CLI bot with no Prometheus server, so its live state is its deployment health above.
            Use Logs to see its per-round trade output.
          </Text>
        </Card>
      )}

      {/* Order book: choose a market to inspect (the maker's symbols, or ad-hoc). */}
      {bot.template === 'market-maker' && status?.status === 'reporting' && status.symbols.length > 0 ? (
        <YStack gap="$2">
          <XStack gap="$2" flexWrap="wrap" items="center">
            <Text fontSize="$2" color="$color10">Inspect book:</Text>
            {status.symbols.map((s) => (
              <Button
                key={s.symbol}
                size="$2"
                bg={book?.symbol === s.symbol ? '$color5' : 'transparent'}
                borderWidth={1}
                borderColor="$borderColor"
                onPress={() => loadBook(s.symbol)}
              >
                {s.symbol}
              </Button>
            ))}
          </XStack>
          {book || loadingBook ? <OrderBookCard book={book} loading={loadingBook} /> : null}
        </YStack>
      ) : null}

      {logs != null ? (
        <YStack gap="$2">
          <Text fontSize="$5" fontWeight="700">Latest deployment logs</Text>
          <Card borderWidth={1} borderColor="$borderColor" p="$3" bg="$color2">
            <Text fontSize="$1" color="$color11" style={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
              {logs}
            </Text>
          </Card>
        </YStack>
      ) : null}
    </YStack>
  )
}

export function TradingModule(props: { params: Record<string, string> }) {
  const routeName = props.params?.name ?? ''
  const [bots, setBots] = useState<BotInstance[]>([])
  const [loading, setLoading] = useState(true)
  const [state, setState] = useState<BackendState | null>(null)
  // Local view: '' = fleet; a bot slug = detail; 'deploy:<tid>' = deploy form.
  const [view, setView] = useState<string>(routeName)

  const load = useCallback(async () => {
    setLoading(true)
    setState(null)
    try {
      const apps = await PaasApi.listAllApps()
      setBots(botsFromApps(apps))
    } catch (e) {
      setState(classifyBackend(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { setView(routeName) }, [routeName])

  const summary = useMemo(() => summarizeFleet(bots), [bots])
  const tradingIcon = findEntry('trading')?.icon

  // Deploy form view.
  if (view.startsWith('deploy:')) {
    const template = findBotTemplate(view.slice('deploy:'.length))
    if (template) {
      return (
        <DeployForm
          template={template}
          onDone={() => { setView(''); load() }}
          onCancel={() => setView('')}
        />
      )
    }
  }

  // Bot detail view.
  const selected = view && !view.startsWith('deploy:') ? bots.find((b) => b.slug === view || b.appId === view) : undefined
  if (selected) {
    return <BotDetail bot={selected} onBack={() => setView('')} onChanged={() => load()} />
  }

  const fleetRows = bots.map((b) => ({
    _id: b.appId,
    slug: b.slug,
    name: b.name,
    kind: b.template === 'market-maker' ? 'Market Maker' : 'Trader',
    network: networkLabel(b.network),
    status: b.health || b.status,
    tag: b.tag ?? '—',
  }))

  return (
    <YStack gap="$4">
      <PageHeader
        title="Trading"
        subtitle="Deploy and manage the Lux DEX trading bots — the market-maker and trader — as native cloud apps. Deploy from a config form to the Hanzo PaaS, watch live quote quality and the order book, and start/stop/redeploy."
        actions={
          <XStack gap="$2" flexWrap="wrap">
            <Button size="$3" onPress={load} disabled={loading}>Refresh</Button>
            {BOT_TEMPLATES.map((t) => (
              <PrimaryButton key={t.id} size="$3" onPress={() => setView(`deploy:${t.id}`)}>
                Deploy {t.label}
              </PrimaryButton>
            ))}
          </XStack>
        }
      />

      {state ? (
        <BackendStateCard state={state} onRetry={load} hint="endpoint · GET /v1/platform/projects" />
      ) : bots.length === 0 && !loading ? (
        tradingIcon ? (
          <EmptyState
            icon={tradingIcon}
            title="No trading bots yet"
            description="Deploy a market-maker or trader bot to your org. The Hanzo PaaS builds it from source (BuildKit → GHCR) and runs it as a singleton — configure its network, markets, and spread, then watch it quote live."
            bullets={[
              'Market Maker — pegs a 2-sided book to the live CEX mid and requotes on a cadence.',
              'Trader — drives sporadic two-sided flow to exercise a market.',
              'Signer keys come from KMS — never typed in the browser.',
            ]}
            primary={{ label: 'Deploy Market Maker', onPress: () => setView('deploy:market-maker') }}
            secondary={{ label: 'Deploy Trader', onPress: () => setView('deploy:trader') }}
          />
        ) : null
      ) : (
        <>
          <XStack gap="$4" flexWrap="wrap">
            <Kpi label="Bots" value={fmtCount(summary.total)} />
            <Kpi label="Running" value={fmtCount(summary.running)} />
            <Kpi label="Stopped" value={fmtCount(summary.stopped)} />
            <Kpi label="Errored" value={fmtCount(summary.error)} />
            <Kpi label="Makers" value={fmtCount(summary.makers)} />
            <Kpi label="Traders" value={fmtCount(summary.traders)} />
          </XStack>

          <DataTable
            fields={FLEET_FIELDS}
            records={fleetRows}
            loading={loading}
            empty="No trading bots deployed."
            onOpen={(row) => setView(String((row as { slug?: string }).slug ?? ''))}
          />
        </>
      )}
    </YStack>
  )
}

