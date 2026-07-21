'use client'

/**
 * Workbench — the persistent Developers dock at the FOOT of the dashboard (the
 * Stripe-Workbench pattern): a slim always-there bar ("Developers" + a `$` prompt
 * + quick icons) that expands into a bottom drawer with three tabs, available on
 * EVERY page without leaving it:
 *
 * - Overview — the org's real API activity (requests · errors · tokens · spend,
 *   last 24h) from the charged commerce usage ledger, with deep links to the full
 *   AI Metrics + API keys surfaces. Real numbers or an honest zero — never mocked.
 * - Logs — the most recent charged API calls (time · model · status · tokens ·
 *   cost), the same ledger rows the Logs product renders.
 * - Shell — a READ-ONLY same-origin `/v1` explorer: `GET /v1/models` (or just
 *   `models`) runs against the caller's own session/org through the ONE `/v1`
 *   surface and pretty-prints the JSON. Mutations stay in the product UIs.
 *
 * Desktop-only (lg+ — like the collapsed sidebar rail, a pointer-density
 * concern); open state persists per-user via the ONE preferences store. Command
 * parsing + output bounding live in the pure `./logic` (tested).
 */
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Input, ScrollView, Text, XStack, YStack } from '@hanzo/gui'
import {
  Activity,
  ChevronDown,
  ChevronUp,
  Maximize2,
  Minimize2,
  RefreshCw,
  ScrollText,
  SquareTerminal,
  X,
} from '@hanzogui/lucide-icons-2'

import {
  fetchUsageRecords,
  recent,
  totalsOf,
  withinRange,
  type UsageRecord,
} from '~/lib/api/aimetrics'
import { ApiError, originV1Url, restGet } from '~/lib/api/client'
import { usePreferences } from '~/lib/products/preferences'
import { MetricCard } from '~/components/ui/Metric'
import { parseCommand, renderOutput } from './logic'

type TabId = 'overview' | 'logs' | 'shell'
type ShellEntry = { cmd: string; output: string; ok: boolean }

const TABS: { id: TabId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'logs', label: 'Logs' },
  { id: 'shell', label: 'Shell' },
]

const usd = (cents: number, dp = 2): string => `$${(cents / 100).toFixed(dp)}`
const timeOf = (ms: number | null): string =>
  ms === null ? '—' : new Date(ms).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })

/** One monospace cell in the Logs grid. */
function Cell({ w, flex, dim, right, children }: { w?: number; flex?: number; dim?: boolean; right?: boolean; children: string }) {
  return (
    <Text
      width={w}
      flex={flex}
      fontSize="$1"
      color={dim ? '$color10' : '$color12'}
      numberOfLines={1}
      className="hz-mono"
      style={right ? { textAlign: 'right' } : undefined}
    >
      {children}
    </Text>
  )
}

function OverviewTab({ records, onGo }: { records: UsageRecord[]; onGo: (path: string) => void }) {
  const day = withinRange(records, '24h', Date.now())
  const totals = totalsOf(day)
  const errors = day.filter((r) => r.status !== '' && r.status !== 'success').length
  return (
    <ScrollView flex={1} minH={0}>
      <YStack p="$3" gap="$3">
        <XStack gap="$3" flexWrap="wrap">
          <MetricCard icon={<Activity size={15} />} label="Requests" value={`${totals.requests}`} caption="Last 24h · charged ledger" />
          <MetricCard icon={<Activity size={15} />} label="Errors" value={`${errors}`} caption="Non-success calls, last 24h" />
          <MetricCard icon={<Activity size={15} />} label="Tokens" value={`${totals.totalTokens}`} caption="Prompt + completion, last 24h" />
          <MetricCard icon={<Activity size={15} />} label="Spend" value={usd(totals.cents)} caption="Charged, last 24h" />
        </XStack>
        <XStack gap="$2">
          <Button size="$2" onPress={() => onGo('/ai-metrics')}>
            AI Metrics
          </Button>
          <Button size="$2" onPress={() => onGo('/api-keys')}>
            API keys
          </Button>
        </XStack>
      </YStack>
    </ScrollView>
  )
}

function LogsTab({ records }: { records: UsageRecord[] }) {
  const rows = recent(records, 50)
  if (rows.length === 0) {
    return (
      <YStack flex={1} items="center" justify="center">
        <Text fontSize="$2" color="$color10">
          No charged API activity yet — calls appear here as they are metered.
        </Text>
      </YStack>
    )
  }
  return (
    <ScrollView flex={1} minH={0}>
      <YStack px="$3" py="$2" gap="$1">
        <XStack gap="$3" pb="$1" borderBottomWidth={1} borderColor="$borderColor">
          <Cell w={90} dim>Time</Cell>
          <Cell flex={1} dim>Model</Cell>
          <Cell w={80} dim>Status</Cell>
          <Cell w={80} dim right>Tokens</Cell>
          <Cell w={80} dim right>Cost</Cell>
        </XStack>
        {rows.map((r) => (
          <XStack key={r.id} gap="$3" py={3}>
            <Cell w={90} dim>{timeOf(r.at)}</Cell>
            <Cell flex={1}>{r.model || r.notes || '—'}</Cell>
            <Cell w={80} dim>{r.status || '—'}</Cell>
            <Cell w={80} right>{`${r.totalTokens}`}</Cell>
            <Cell w={80} right>{usd(r.cents, 4)}</Cell>
          </XStack>
        ))}
      </YStack>
    </ScrollView>
  )
}

function ShellTab() {
  const [entries, setEntries] = useState<ShellEntry[]>([])
  const [input, setInput] = useState('')
  const [running, setRunning] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' })
  }, [entries])

  const run = async () => {
    const line = input.trim()
    if (!line || running) return
    setInput('')
    const parsed = parseCommand(line)
    if ('error' in parsed) {
      setEntries((e) => [...e, { cmd: line, output: parsed.error, ok: false }])
      return
    }
    setRunning(true)
    try {
      const data = await restGet<unknown>(originV1Url(parsed.path))
      setEntries((e) => [...e, { cmd: line, output: renderOutput(data), ok: true }])
    } catch (err) {
      const output =
        err instanceof ApiError ? `HTTP ${err.status} — ${err.message}` : err instanceof Error ? err.message : String(err)
      setEntries((e) => [...e, { cmd: line, output, ok: false }])
    } finally {
      setRunning(false)
    }
  }

  return (
    <YStack flex={1} minH={0}>
      <ScrollView flex={1} minH={0}>
        <YStack p="$3" gap="$2">
          {entries.length === 0 ? (
            <Text fontSize="$1" color="$color10" className="hz-mono">
              Read-only /v1 explorer — try `GET /v1/models` or just `models`. Runs as you, in your org.
            </Text>
          ) : null}
          {entries.map((e, i) => (
            <YStack key={i} gap="$1">
              <Text fontSize="$1" color="$color11" className="hz-mono">
                $ {e.cmd}
              </Text>
              <Text fontSize="$1" color={e.ok ? '$color12' : '#e5534b'} className="hz-mono" style={{ whiteSpace: 'pre-wrap' }}>
                {e.output}
              </Text>
            </YStack>
          ))}
          <div ref={endRef} />
        </YStack>
      </ScrollView>
      <XStack items="center" gap="$2" px="$3" height={44} borderTopWidth={1} borderColor="$borderColor">
        <Text fontSize="$2" color="$color10" className="hz-mono">
          $
        </Text>
        <Input
          flex={1}
          unstyled
          autoFocus
          value={input}
          onChangeText={setInput}
          onSubmitEditing={() => void run()}
          placeholder={running ? 'Running…' : 'Enter a /v1 command…'}
          fontSize="$2"
          color="$color12"
          className="hz-mono"
          autoCapitalize="none"
          autoCorrect={false}
          aria-label="Workbench shell command"
        />
      </XStack>
    </YStack>
  )
}

export function WorkbenchDock() {
  const router = useRouter()
  const { get, set } = usePreferences()
  const open = get<boolean>('workbenchOpen', false)
  const [tab, setTab] = useState<TabId>('overview')
  const [tall, setTall] = useState(false)
  const [records, setRecords] = useState<UsageRecord[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setLoadError(null)
    try {
      setRecords(await fetchUsageRecords())
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (open && records === null && !loading) void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const openTo = (t: TabId) => {
    setTab(t)
    if (!open) set('workbenchOpen', true)
  }
  const go = (path: string) => {
    router.push(path)
    set('workbenchOpen', false)
  }

  const body =
    tab === 'shell' ? (
      <ShellTab />
    ) : loading || (records === null && !loadError) ? (
      <YStack flex={1} items="center" justify="center">
        <Text fontSize="$2" color="$color10">
          Loading usage…
        </Text>
      </YStack>
    ) : loadError ? (
      <YStack flex={1} items="center" justify="center" gap="$2">
        <Text fontSize="$2" color="$color10">
          Could not load the usage ledger — {loadError}
        </Text>
        <Button size="$2" onPress={() => void load()}>
          Retry
        </Button>
      </YStack>
    ) : tab === 'overview' ? (
      <OverviewTab records={records ?? []} onGo={go} />
    ) : (
      <LogsTab records={records ?? []} />
    )

  return (
    <YStack display="none" $lg={{ display: 'flex' }} borderTopWidth={1} borderColor="$borderColor" bg="$color1">
      {open ? (
        <YStack style={{ height: tall ? '70vh' : 380 }} borderBottomWidth={1} borderColor="$borderColor">
          <XStack items="center" gap="$1" px="$2" height={40} borderBottomWidth={1} borderColor="$borderColor">
            {TABS.map((t) => (
              <Button
                key={t.id}
                size="$2"
                chromeless
                bg={tab === t.id ? '$color4' : 'transparent'}
                onPress={() => setTab(t.id)}
                aria-label={t.label}
              >
                {t.label}
              </Button>
            ))}
            <XStack flex={1} />
            {tab !== 'shell' ? (
              <Button
                size="$2"
                chromeless
                icon={<RefreshCw size={14} />}
                onPress={() => void load()}
                aria-label="Refresh usage"
              />
            ) : null}
            <Button
              size="$2"
              chromeless
              icon={tall ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
              onPress={() => setTall(!tall)}
              aria-label={tall ? 'Shrink workbench' : 'Expand workbench'}
            />
            <Button size="$2" chromeless icon={<X size={14} />} onPress={() => set('workbenchOpen', false)} aria-label="Close workbench" />
          </XStack>
          {body}
        </YStack>
      ) : null}

      {/* The always-there Developers bar — the dock's collapsed face. */}
      <XStack items="center" gap="$2" px="$2" height={38}>
        <Button
          size="$2"
          chromeless
          icon={<SquareTerminal size={15} />}
          onPress={() => set('workbenchOpen', !open)}
          aria-label={open ? 'Collapse the workbench' : 'Open the workbench'}
        >
          <Text fontSize="$2" fontWeight="600" color="$color11">
            Developers
          </Text>
        </Button>
        {!open ? (
          <XStack flex={1} items="center" px="$2" cursor="pointer" onPress={() => openTo('shell')}>
            <Text fontSize="$1" color="$color9" className="hz-mono" numberOfLines={1}>
              $ Run a /v1 command…
            </Text>
          </XStack>
        ) : (
          <XStack flex={1} />
        )}
        <Button size="$2" chromeless icon={<Activity size={15} />} onPress={() => openTo('overview')} aria-label="API activity" />
        <Button size="$2" chromeless icon={<ScrollText size={15} />} onPress={() => openTo('logs')} aria-label="Recent API logs" />
        <Button
          size="$2"
          chromeless
          icon={open ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
          onPress={() => set('workbenchOpen', !open)}
          aria-label={open ? 'Collapse the workbench' : 'Open the workbench'}
        />
      </XStack>
    </YStack>
  )
}
