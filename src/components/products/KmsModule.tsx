'use client'

/**
 * Secrets (KMS) — a names-only inventory over the server-gated `/admin/kms` proxy.
 *
 * Hanzo KMS is zero-knowledge: there is deliberately NO "list every secret value"
 * endpoint, and a browser session cookie is not KMS authorization. So this module
 * lists secret METADATA only (path / name / env / version) via `KmsAdminApi.list`
 * — the proxy enforces the brand-admin gate and forwards as the user, scoped to
 * the active org. Values are NEVER fetched or rendered here. States are honest:
 * loading, operator-access-required (403), listing-unavailable (404 — kmsd without
 * the metadata-list endpoint), error, and empty.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Text, XStack } from '@hanzo/gui'
import { ExternalLink, RefreshCw, ShieldCheck } from '@hanzogui/lucide-icons-2'

import { ApiError, KmsAdminApi, type KmsSecretMeta } from '~/lib/api'
import { currentOrg, isScopedAway } from '~/lib/org-scope'
import { config } from '~/config'
import { PageHeader } from '~/components/ui/PageHeader'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { ErrorState, asApiError, isForbidden, OperatorAccessRequired, type HonestCopy } from '~/components/ui/States'

const KMS_CONSOLE = 'https://kms.hanzo.ai'

/** KMS-specific guidance for the honest 404 / unauthorized states. */
const KMS_COPY: HonestCopy = {
  notFound:
    'Secret listing requires Hanzo KMS with the metadata-list endpoint (v0.159.4+). The inventory appears automatically once kmsd is upgraded — only names are listed, never values.',
  unauthorized:
    'This view requires an operator session. Access is enforced server-side by the admin gate — sign in with an @hanzo.ai admin account.',
}

const fmtDate = (v?: string): string => {
  if (!v) return '—'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? v : d.toLocaleString()
}

const columns: Column<KmsSecretMeta>[] = [
  { key: 'name', header: 'Name', render: (s) => <Text fontSize="$3" fontWeight="600" numberOfLines={1}>{s.name}</Text> },
  { key: 'path', header: 'Path', render: (s) => <Text fontSize="$3" color="$color11" numberOfLines={1}>{s.path || '—'}</Text> },
  { key: 'env', header: 'Env', width: 130, render: (s) => <Text fontSize="$3" color="$color11">{s.env || 'default'}</Text> },
  { key: 'version', header: 'Version', width: 100, render: (s) => <Text fontSize="$3" color="$color11">{s.version || '—'}</Text> },
  { key: 'updatedTime', header: 'Updated', width: 200, render: (s) => <Text fontSize="$3" color="$color10">{fmtDate(s.updatedTime)}</Text> },
]

type LoadState =
  | { phase: 'loading' }
  | { phase: 'error'; err: ApiError }
  | { phase: 'ready'; rows: KmsSecretMeta[] }

export function KmsModule(_props: { params: Record<string, string> }) {
  const [state, setState] = useState<LoadState>({ phase: 'loading' })
  const org = currentOrg()

  const run = useCallback(() => {
    setState({ phase: 'loading' })
    KmsAdminApi.list({ org })
      .then((rows) => setState({ phase: 'ready', rows }))
      .catch((e) => setState({ phase: 'error', err: asApiError(e) }))
  }, [org])

  useEffect(() => {
    run()
  }, [run])

  const open = () => {
    if (typeof window !== 'undefined') window.open(KMS_CONSOLE, '_blank', 'noopener')
  }

  return (
    <>
      <PageHeader
        title="Secrets"
        subtitle={`Secret inventory (names only) for ${org}${isScopedAway() ? '' : ' — your organization'}. Values are never listed; manage them in the KMS console.`}
        actions={
          <XStack gap="$2">
            <Button size="$2" icon={<RefreshCw size={15} />} onPress={run}>
              Refresh
            </Button>
            <Button icon={<ExternalLink size={15} />} onPress={open}>
              KMS console
            </Button>
          </XStack>
        }
      />

      <Card p="$3.5" gap="$2" borderWidth={1} borderColor="$borderColor" maxWidth={820}>
        <XStack gap="$2" items="center">
          <ShieldCheck size={18} />
          <Text fontSize="$4" fontWeight="700">
            Zero-knowledge by design
          </Text>
        </XStack>
        <Text fontSize="$3" color="$color11">
          KMS encrypts secret names and values on the MPC nodes. This inventory lists names and
          versions only — each value is revealed solely on explicit, audited access in the KMS
          console. The console never fetches or stores a secret value.
        </Text>
      </Card>

      {state.phase === 'error' ? (
        isForbidden(state.err) ? (
          <OperatorAccessRequired />
        ) : (
          <ErrorState err={state.err} onRetry={run} copy={KMS_COPY} />
        )
      ) : (
        <DataTable
          columns={columns}
          rows={state.phase === 'ready' ? state.rows : []}
          loading={state.phase === 'loading'}
          rowKey={(s) => `${s.path}/${s.name}/${s.env}`}
          empty={`No secrets in ${org}.`}
        />
      )}

      <Text fontSize="$2" color="$color10">
        endpoint · /v1/kms/orgs/{org}/secrets · {config.brandName}
      </Text>
    </>
  )
}
