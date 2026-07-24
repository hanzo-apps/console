'use client'

/**
 * Workbench — the persistent Developers dock at the FOOT of the dashboard (the
 * Stripe-Workbench pattern): a slim always-there bar ("Developers" + a `$` prompt
 * + quick icons) that expands into a bottom drawer of developer tabs, available on
 * EVERY page without leaving it. Desktop-only (lg+ — a pointer-density concern);
 * open state persists per-user via the ONE preferences store.
 *
 * The full developer tab set — each org-scoped, wired to REAL Hanzo data (or an
 * honest empty/coming/runtime state), each mounted only while active (lazy):
 *
 *  - Overview  — integration snapshot: request volume + error rate + tokens/spend
 *    (charged ledger), the account's Cloud API key, the API version + dev-resource
 *    links (docs · reference · SDKs · CLI).
 *  - Logs      — the recent charged API calls, filterable, row → JSON detail.
 *  - Events    — the platform-event stream projected from the same real ledger.
 *  - Webhooks  — a read-only live glance at the org's endpoints that deep-links into
 *    the full Webhooks product (which owns config/security/test/logs CRUD).
 *  - Health    — Alerts · Errors · Insights from the o11y runtime.
 *  - Inspector — fetch any object by id (agent_… / fn_… / a resource path) → JSON.
 *  - Traces    — the existing TracesModule (LLM/agent traces), embedded.
 *  - Shell     — a read-only /v1 explorer with a resource picker + show-code.
 *
 * The ledger-backed tabs (Overview/Logs/Events) share the ONE usage fetch owned
 * here; the heavier tabs load their own data on selection. Command parsing + the
 * id router live in the pure `./logic` (tested).
 */
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, ScrollView, Text, XStack, YStack } from '@hanzo/gui'
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

import { fetchUsageRecords, type UsageRecord } from '~/lib/api/aimetrics'
import { usePreferences } from '~/lib/products/preferences'
import {
  EventsTab,
  HealthTab,
  InspectorTab,
  LogsTab,
  OverviewTab,
  ShellTab,
  TracesTab,
  WebhooksTab,
} from './tabs'

type TabId = 'overview' | 'logs' | 'events' | 'webhooks' | 'health' | 'inspector' | 'traces' | 'shell'

const TABS: { id: TabId; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'logs', label: 'Logs' },
  { id: 'events', label: 'Events' },
  { id: 'webhooks', label: 'Webhooks' },
  { id: 'health', label: 'Health' },
  { id: 'inspector', label: 'Inspector' },
  { id: 'traces', label: 'Traces' },
  { id: 'shell', label: 'Shell' },
]

/** The tabs that read the shared usage ledger (loaded once, here). */
const LEDGER_TABS: ReadonlySet<TabId> = new Set<TabId>(['overview', 'logs', 'events', 'inspector'])

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

  // Load the ledger the first time it is needed (dock opened onto a ledger tab).
  useEffect(() => {
    if (open && LEDGER_TABS.has(tab) && records === null && !loading) void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tab])

  const openTo = (t: TabId) => {
    setTab(t)
    if (!open) set('workbenchOpen', true)
  }
  const go = (path: string) => {
    router.push(path)
    set('workbenchOpen', false)
  }

  const ledgerBacked = tab === 'overview' || tab === 'logs' || tab === 'events'

  const ledgerBody =
    loading || (records === null && !loadError) ? (
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
    ) : tab === 'logs' ? (
      <LogsTab records={records ?? []} />
    ) : (
      <EventsTab records={records ?? []} />
    )

  const body =
    tab === 'shell' ? (
      <ShellTab />
    ) : tab === 'traces' ? (
      <TracesTab />
    ) : tab === 'webhooks' ? (
      <WebhooksTab onGo={go} />
    ) : tab === 'health' ? (
      <HealthTab />
    ) : tab === 'inspector' ? (
      <InspectorTab records={records ?? []} />
    ) : (
      ledgerBody
    )

  return (
    <YStack display="none" $lg={{ display: 'flex' }} borderTopWidth={1} borderColor="$borderColor" bg="$color1">
      {open ? (
        <YStack style={{ height: tall ? '70vh' : 380 }} borderBottomWidth={1} borderColor="$borderColor">
          <XStack items="center" gap="$1" px="$2" height={40} borderBottomWidth={1} borderColor="$borderColor">
            <ScrollView horizontal showsHorizontalScrollIndicator={false} flex={1}>
              <XStack items="center" gap="$1">
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
              </XStack>
            </ScrollView>
            {ledgerBacked ? (
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

      {/* The always-there Developers bar — the dock's collapsed face. A DISTINCT
          footer strip (tinted bg, taller, clear label) so it reads as a real dock,
          not a hairline. */}
      <XStack items="center" gap="$2" px="$3" height={44} bg="$color2">
        <Button
          size="$2"
          bg="$color4"
          borderWidth={1}
          borderColor="$borderColor"
          icon={<SquareTerminal size={16} />}
          onPress={() => set('workbenchOpen', !open)}
          aria-label={open ? 'Collapse the workbench' : 'Open the workbench'}
        >
          <Text fontSize="$2" fontWeight="700" color="$color12">
            Developers
          </Text>
        </Button>
        {!open ? (
          <XStack
            flex={1}
            items="center"
            gap="$2"
            px="$3"
            height={30}
            rounded="$3"
            borderWidth={1}
            borderColor="$borderColor"
            bg="$color1"
            cursor="pointer"
            hoverStyle={{ borderColor: '$color8' }}
            onPress={() => openTo('shell')}
          >
            <Text fontSize="$2" color="$color11" className="hz-mono">
              $
            </Text>
            <Text flex={1} fontSize="$2" color="$color10" className="hz-mono" numberOfLines={1}>
              Run a /v1 command — models, agents, logs…
            </Text>
          </XStack>
        ) : (
          <XStack flex={1} />
        )}
        <Button size="$2" chromeless icon={<Activity size={16} />} onPress={() => openTo('overview')} aria-label="API activity" />
        <Button size="$2" chromeless icon={<ScrollText size={16} />} onPress={() => openTo('logs')} aria-label="Recent API logs" />
        <Button
          size="$2"
          icon={open ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
          onPress={() => set('workbenchOpen', !open)}
          aria-label={open ? 'Collapse the workbench' : 'Open the workbench'}
        >
          {open ? 'Hide' : 'Open'}
        </Button>
      </XStack>
    </YStack>
  )
}
