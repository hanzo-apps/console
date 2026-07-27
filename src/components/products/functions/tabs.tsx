'use client'

/**
 * The lighter Functions tabs — Deployments, Triggers, Secrets, Settings. Each is a
 * thin real `/v1/functions/*` read with honest loading/empty/backend states; none
 * fabricates rows. Secrets shows NAMES only (values are never fetched/rendered —
 * the Secret Manager principle, mirroring the names-only KMS inventory). Settings
 * summarizes the inventory + engine and hands off to inline docs, never a link-out
 * as the way to manage the product.
 *
 * Style props use the v5 shorthand set (bg/p/px/py/gap/rounded/items/self/...).
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { BookOpen, Lock, Terminal } from '@hanzogui/lucide-icons-2'

import {
  FunctionsApi,
  namespacesOf,
  fmtRelative,
  type FunctionTrigger,
  type ServerlessFunction,
} from '~/lib/api/functions'
import { DataTable, type Column } from '@hanzo/ui/product'
import { StatusTag } from '@hanzo/ui/product'
import { BackendStateCard, classifyBackend, type BackendState } from '@hanzo/ui/product'
import { DetailRow, Badge } from '~/components/products/observability/parts'

type Async<T> = { phase: 'loading' } | { phase: 'error'; error: BackendState } | { phase: 'ready'; data: T }

const openExternal = (href: string) => {
  if (typeof window !== 'undefined') window.open(href, '_blank', 'noopener')
}

/** Generic loader for a tab's one `/v1/functions/*` read. */
function useResource<T>(fetcher: () => Promise<T>): { state: Async<T>; reload: () => void } {
  const [state, setState] = useState<Async<T>>({ phase: 'loading' })
  const reload = useCallback(() => {
    setState({ phase: 'loading' })
    fetcher()
      .then((data) => setState({ phase: 'ready', data }))
      .catch((e) => setState({ phase: 'error', error: classifyBackend(e) }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => reload(), [reload])
  return { state, reload }
}

// ── Deployments ──────────────────────────────────────────────────────────────

export function DeploymentsTab({ hint }: { hint: string }) {
  const { state, reload } = useResource(() => FunctionsApi.deployments())
  const columns: Column<ServerlessFunction>[] = [
    { key: 'name', header: 'Function', render: (f) => <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>{f.name}</Text> },
    { key: 'namespace', header: 'Namespace', width: 140, render: (f) => <Text fontSize="$3" color="$color11">{f.namespace}</Text> },
    { key: 'image', header: 'Image', width: 220, render: (f) => <Text fontSize="$2" color="$color10" numberOfLines={1}>{f.image ?? '—'}</Text> },
    { key: 'lastDeployedAt', header: 'Deployed', width: 140, render: (f) => <Text fontSize="$3" color="$color11">{fmtRelative(f.lastDeployedAt)}</Text> },
    { key: 'status', header: 'Status', width: 110, render: (f) => <StatusTag status={f.status} /> },
  ]
  if (state.phase === 'error') return <BackendStateCard state={state.error} onRetry={reload} hint={hint} />
  return (
    <DataTable
      columns={columns}
      rows={state.phase === 'ready' ? state.data : []}
      loading={state.phase === 'loading'}
      rowKey={(f) => `${f.namespace}/${f.name}`}
      empty="No deployment history yet."
    />
  )
}

// ── Triggers ─────────────────────────────────────────────────────────────────

export function TriggersTab({ hint }: { hint: string }) {
  const { state, reload } = useResource(() => FunctionsApi.triggers())
  const columns: Column<FunctionTrigger>[] = [
    { key: 'name', header: 'Trigger', render: (t) => <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>{t.name}</Text> },
    { key: 'type', header: 'Type', width: 130, render: (t) => <Badge label={t.type} /> },
    { key: 'target', header: 'Target', render: (t) => <Text fontSize="$2" color="$color11" numberOfLines={1}>{t.target ?? '—'}</Text> },
    { key: 'functionName', header: 'Function', width: 160, render: (t) => <Text fontSize="$3" color="$color11" numberOfLines={1}>{t.functionName ?? '—'}</Text> },
    { key: 'enabled', header: 'State', width: 100, render: (t) => <Text fontSize="$1" color={t.enabled ? '#3fb950' : '$color10'}>{t.enabled ? 'enabled' : 'disabled'}</Text> },
  ]
  if (state.phase === 'error') return <BackendStateCard state={state.error} onRetry={reload} hint={hint} />
  return (
    <DataTable
      columns={columns}
      rows={state.phase === 'ready' ? state.data : []}
      loading={state.phase === 'loading'}
      rowKey={(t) => t.id}
      empty="No triggers configured yet."
    />
  )
}

// ── Secrets (names only) ─────────────────────────────────────────────────────

type FnSecret = { name: string; namespace?: string; mountedBy?: string }

export function SecretsTab({ hint, docsHref }: { hint: string; docsHref: string }) {
  const { state, reload } = useResource(() => FunctionsApi.secrets())
  const columns: Column<FnSecret>[] = [
    { key: 'name', header: 'Secret', render: (s) => <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>{s.name}</Text> },
    { key: 'namespace', header: 'Namespace', width: 160, render: (s) => <Text fontSize="$3" color="$color11">{s.namespace ?? '—'}</Text> },
    { key: 'mountedBy', header: 'Mounted by', render: (s) => <Text fontSize="$3" color="$color11" numberOfLines={1}>{s.mountedBy ?? '—'}</Text> },
  ]
  return (
    <YStack gap="$3">
      <Card borderWidth={1} borderColor="$borderColor" p="$3.5" gap="$1.5">
        <XStack items="center" gap="$2">
          <Lock size={15} />
          <Text fontSize="$3" fontWeight="700" color="$color12">
            Names only — values are never read or shown
          </Text>
        </XStack>
        <Text fontSize="$2" color="$color10">
          Function secrets are managed in Hanzo KMS and mounted by reference. This list shows which
          secrets are bound to functions; their values never leave KMS and are never fetched here.
        </Text>
        <XStack>
          <Button size="$2" chromeless icon={<BookOpen size={13} />} onPress={() => openExternal(docsHref)}>
            Secrets & KMS guide
          </Button>
        </XStack>
      </Card>
      {state.phase === 'error' ? (
        <BackendStateCard state={state.error} onRetry={reload} hint={hint} />
      ) : (
        <DataTable
          columns={columns}
          rows={state.phase === 'ready' ? state.data : []}
          loading={state.phase === 'loading'}
          rowKey={(s) => `${s.namespace ?? ''}/${s.name}`}
          empty="No secrets bound to functions."
        />
      )}
    </YStack>
  )
}

// ── Settings ─────────────────────────────────────────────────────────────────

export function SettingsTab({
  functions,
  live,
  docsHref,
}: {
  functions: ServerlessFunction[]
  live: boolean
  docsHref: string
}) {
  const namespaces = namespacesOf(functions)
  return (
    <YStack gap="$3" maxW={720}>
      <Card borderWidth={1} borderColor="$borderColor" p="$4" gap="$2">
        <Text fontSize="$4" fontWeight="800" color="$color12">
          Runtime
        </Text>
        <DetailRow label="Engine" value="Hanzo Functions (Kubernetes-native serverless)" />
        <DetailRow label="Backend" value={live ? 'Connected' : 'Not connected on this deployment'} />
        <DetailRow label="Functions" value={`${functions.length}`} />
        <DetailRow label="Namespaces" value={namespaces.length ? namespaces.join(', ') : '—'} />
        <DetailRow label="Inventory route" value="GET /v1/functions" />
      </Card>

      <Card borderWidth={1} borderColor="$borderColor" p="$4" gap="$2">
        <XStack items="center" gap="$2">
          <Terminal size={16} />
          <Text fontSize="$4" fontWeight="800" color="$color12">
            Deploy a function
          </Text>
        </XStack>
        <Text fontSize="$3" color="$color11">
          Functions are deployed from source through the CLI, which packages your handler against a
          runtime environment and registers it with the control plane.
        </Text>
        <YStack bg="$color2" rounded="$3" p="$3" borderWidth={1} borderColor="$borderColor">
          <Text fontSize="$2" color="$color11" selectable style={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
            {'hanzo fn deploy resize \\\n  --env node \\\n  --src ./resize \\\n  --entry handler'}
          </Text>
        </YStack>
        <XStack>
          <Button size="$2" chromeless icon={<BookOpen size={13} />} onPress={() => openExternal(docsHref)}>
            Functions documentation
          </Button>
        </XStack>
      </Card>
    </YStack>
  )
}
