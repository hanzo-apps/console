'use client'

/**
 * Model catalog — the available models served by the gateway, native on @hanzo/gui.
 *
 * Ported from hanzoai/console features/cloud-models (ModelsTable + ProviderFilter):
 * the provider filter, the premium badge, and the $/Mtok price columns. Data is
 * the REAL `/v1/models` list (`CloudModelApi`) with a best-effort pricing overlay.
 * Read-only — models come from providers + routes (their own modules). Loading,
 * error (404 not routed / 401 / 503), and empty are honest states; prices that
 * the pricing API doesn't return read "—" rather than being fabricated.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Text, XStack } from '@hanzo/gui'
import { RefreshCw } from '@hanzogui/lucide-icons-2'

import { ApiError, CloudModelApi, providerLabels, type CatalogModel } from '~/lib/api'
import { PageHeader } from '~/components/ui/PageHeader'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { ErrorState, asApiError } from '~/components/ui/States'

/** Format a $/million-tokens price the same way the source ModelsTable did. */
function formatPrice(perMillion?: number): string {
  if (perMillion == null) return '—'
  if (perMillion === 0) return 'Free'
  if (perMillion < 0.01) return `$${perMillion.toFixed(4)}`
  if (perMillion < 1) return `$${perMillion.toFixed(3)}`
  return `$${perMillion.toFixed(2)}`
}

const Badge = ({ on, label }: { on: boolean; label: string }) => (
  <Text
    fontSize="$1"
    px="$2"
    py="$1"
    rounded="$2"
    bg={on ? '$color5' : '$color3'}
    color={on ? '$color12' : '$color11'}
  >
    {label}
  </Text>
)

type LoadState =
  | { phase: 'loading' }
  | { phase: 'error'; err: ApiError }
  | { phase: 'ready'; models: CatalogModel[] }

const columns: Column<CatalogModel>[] = [
  {
    key: 'id',
    header: 'Model',
    render: (m) => (
      <Text fontSize="$3" color="$color12" numberOfLines={1}>
        {m.id}
      </Text>
    ),
  },
  {
    key: 'owned_by',
    header: 'Provider',
    width: 180,
    render: (m) => <Text fontSize="$3">{providerLabels[m.owned_by] ?? m.owned_by}</Text>,
  },
  {
    key: 'premium',
    header: 'Tier',
    width: 110,
    render: (m) => <Badge on={!!m.premium} label={m.premium ? 'Premium' : 'Standard'} />,
  },
  {
    key: 'input',
    header: 'Input $/Mtok',
    width: 130,
    render: (m) => <Text fontSize="$3" color="$color11">{formatPrice(m.pricing?.inputPerMillion)}</Text>,
  },
  {
    key: 'output',
    header: 'Output $/Mtok',
    width: 130,
    render: (m) => <Text fontSize="$3" color="$color11">{formatPrice(m.pricing?.outputPerMillion)}</Text>,
  },
]

export function ModelCatalogModule(_props: { params: Record<string, string> }) {
  const [state, setState] = useState<LoadState>({ phase: 'loading' })
  const [provider, setProvider] = useState<string | null>(null)

  const run = useCallback(() => {
    setState({ phase: 'loading' })
    CloudModelApi.list()
      .then((models) => setState({ phase: 'ready', models }))
      .catch((e) => setState({ phase: 'error', err: asApiError(e) }))
  }, [])

  useEffect(() => {
    run()
  }, [run])

  const models = state.phase === 'ready' ? state.models : []

  const providers = useMemo(
    () => Array.from(new Set(models.map((m) => m.owned_by))).sort(),
    [models],
  )

  const rows = useMemo(
    () => (provider ? models.filter((m) => m.owned_by === provider) : models),
    [models, provider],
  )

  return (
    <>
      <PageHeader
        title="Model Catalog"
        subtitle="Available models across providers, with pricing. Routing is configured in Models; credentials in Providers."
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
              'The model catalog (/v1/models) is not routed on this host yet. It appears automatically once the deployment proxies /v1/models through the gateway.',
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
                  {providerLabels[p] ?? p}
                </Button>
              ))}
            </XStack>
          ) : null}

          <DataTable
            columns={columns}
            rows={rows}
            loading={state.phase === 'loading'}
            rowKey={(m) => m.id}
            empty="No models available on this deployment yet."
          />
        </>
      )}
    </>
  )
}
