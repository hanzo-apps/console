'use client'

/**
 * Model Catalog — the real, rich model catalog on @hanzo/gui.
 *
 * Source: the unified `/v1/pricing/models` catalog via `aicatalog.fetchCatalog`
 * (through the `/ai` proxy, so the user bearer is attached). Every column is a
 * REAL field — name + params (specs), modality (derived from the id), context,
 * per-Mtok input/output pricing, the TRUE provider (so qwen→Qwen, glm→Zhipu, our
 * own → "Zen" — never the old "everything is Hanzo" mislabel), and a live
 * Available status (servable now) vs catalog-only. Honest loading/error/empty;
 * nothing fabricated. Filter by provider; "Zen" surfaces our first-party models.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Text, XStack, YStack } from '@hanzo/gui'
import { RefreshCw } from '@hanzogui/lucide-icons-2'

import {
  fetchCatalog,
  displayProvider,
  modelType,
  fmtPrice,
  fmtContext,
  type CatalogEntry,
} from '~/lib/api/aicatalog'
import { PageHeader } from '~/components/ui/PageHeader'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { ErrorState, asApiError } from '~/components/ui/States'
import type { ApiError } from '~/lib/api'

const Pill = ({ label, tone = 'muted' }: { label: string; tone?: 'muted' | 'live' }) => (
  <Text
    fontSize="$1"
    px="$2"
    py="$1"
    rounded="$2"
    bg={tone === 'live' ? '$green3' : '$color3'}
    color={tone === 'live' ? '$green11' : '$color11'}
  >
    {label}
  </Text>
)

const columns: Column<CatalogEntry>[] = [
  {
    key: 'name',
    header: 'Model',
    render: (m) => (
      <YStack gap={1}>
        <XStack items="center" gap="$2">
          <Text fontSize="$3" color="$color12" numberOfLines={1}>
            {m.name}
          </Text>
          {m.specs?.params ? (
            <Text fontSize="$1" color="$color10">
              {m.specs.params}
            </Text>
          ) : null}
        </XStack>
        {m.description ? (
          <Text fontSize="$1" color="$color10" numberOfLines={1}>
            {m.description}
          </Text>
        ) : null}
      </YStack>
    ),
  },
  {
    key: 'type',
    header: 'Type',
    width: 110,
    render: (m) => <Pill label={modelType(m)} />,
  },
  {
    key: 'context',
    header: 'Context',
    width: 100,
    render: (m) => <Text fontSize="$3" color="$color11">{fmtContext(m.context)}</Text>,
  },
  {
    key: 'input',
    header: 'Input $/M',
    width: 110,
    render: (m) => <Text fontSize="$3" color="$color11">{fmtPrice(m.pricing?.input)}</Text>,
  },
  {
    key: 'output',
    header: 'Output $/M',
    width: 110,
    render: (m) => <Text fontSize="$3" color="$color11">{fmtPrice(m.pricing?.output)}</Text>,
  },
  {
    key: 'provider',
    header: 'Provider',
    width: 140,
    render: (m) => <Text fontSize="$3">{displayProvider(m.provider)}</Text>,
  },
  {
    key: 'status',
    header: 'Status',
    width: 120,
    render: (m) =>
      m.available ? <Pill label="● Available" tone="live" /> : <Pill label="Catalog" />,
  },
]

const Stat = ({ label, value }: { label: string; value: string }) => (
  <YStack flex={1} gap={2} px="$3" py="$2.5">
    <Text fontSize="$6" fontWeight="700" color="$color12">
      {value}
    </Text>
    <Text fontSize="$1" color="$color10">
      {label}
    </Text>
  </YStack>
)

type LoadState =
  | { phase: 'loading' }
  | { phase: 'error'; err: ApiError }
  | { phase: 'ready'; models: CatalogEntry[] }

export function ModelCatalogModule(_props: { params: Record<string, string> }) {
  const [state, setState] = useState<LoadState>({ phase: 'loading' })
  const [provider, setProvider] = useState<string | null>(null)

  const run = useCallback(() => {
    setState({ phase: 'loading' })
    fetchCatalog()
      .then((models) => setState({ phase: 'ready', models }))
      .catch((e) => setState({ phase: 'error', err: asApiError(e) }))
  }, [])

  useEffect(() => {
    run()
  }, [run])

  const models = state.phase === 'ready' ? state.models : []

  // Provider filter options, sorted by display name; "Zen" (our own) first.
  const providers = useMemo(() => {
    const set = new Map<string, string>()
    for (const m of models) set.set(displayProvider(m.provider), displayProvider(m.provider))
    return Array.from(set.keys()).sort((a, b) =>
      a === 'Zen' ? -1 : b === 'Zen' ? 1 : a.localeCompare(b),
    )
  }, [models])

  const rows = useMemo(
    () => (provider ? models.filter((m) => displayProvider(m.provider) === provider) : models),
    [models, provider],
  )

  const stats = useMemo(() => {
    const ctxs = rows.map((m) => m.context).filter((x): x is number => typeof x === 'number')
    const ins = rows.map((m) => m.pricing?.input).filter((x): x is number => typeof x === 'number')
    const provCount = new Set(rows.map((m) => displayProvider(m.provider))).size
    const avgIn = ins.length ? ins.reduce((a, b) => a + b, 0) / ins.length : null
    return {
      total: String(rows.length),
      ctx: ctxs.length ? `${fmtContext(Math.min(...ctxs))} – ${fmtContext(Math.max(...ctxs))}` : '—',
      avg: avgIn != null ? `$${avgIn.toFixed(2)}` : '—',
      providers: String(provCount),
    }
  }, [rows])

  return (
    <>
      <PageHeader
        title="Model Catalog"
        subtitle="Explore and deploy the best open AI models. All models are routeable and usage-based."
        actions={
          <Button size="$2" icon={<RefreshCw size={15} />} onPress={run}>
            Refresh
          </Button>
        }
      />

      {state.phase === 'error' ? (
        <ErrorState
          err={state.err}
          onRetry={run}
          copy={{
            notFound:
              'The model catalog (/v1/pricing/models) is not routed on this host yet. It appears automatically once the deployment proxies it through the gateway.',
          }}
        />
      ) : (
        <>
          {providers.length > 0 ? (
            <XStack gap="$1" flexWrap="wrap">
              <Button
                size="$2"
                bg={provider === null ? '$color5' : 'transparent'}
                borderWidth={1}
                borderColor="$borderColor"
                onPress={() => setProvider(null)}
              >
                All
              </Button>
              {providers.map((p) => (
                <Button
                  key={p}
                  size="$2"
                  bg={provider === p ? '$color5' : 'transparent'}
                  borderWidth={1}
                  borderColor="$borderColor"
                  onPress={() => setProvider(p)}
                >
                  {p}
                </Button>
              ))}
            </XStack>
          ) : null}

          <DataTable
            columns={columns}
            rows={rows}
            loading={state.phase === 'loading'}
            rowKey={(m) => m.name}
            empty="No models available on this deployment yet."
          />

          {state.phase === 'ready' && rows.length > 0 ? (
            <XStack
              rounded="$4"
              borderWidth={1}
              borderColor="$borderColor"
              bg="$color1"
              mt="$2"
              flexWrap="wrap"
            >
              <Stat label="Total models" value={stats.total} />
              <Stat label="Context range" value={stats.ctx} />
              <Stat label="Avg. input / Mtok" value={stats.avg} />
              <Stat label="Providers" value={stats.providers} />
            </XStack>
          ) : null}
        </>
      )}
    </>
  )
}
