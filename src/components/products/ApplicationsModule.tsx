'use client'

/**
 * Applications — the org's DEPLOYED application services (running workloads), over the
 * Hanzo platform control plane (`GET /v1/apps` via the same-origin `/paas` proxy). This
 * is the Compute "Applications" surface: real deployed services with their env, cluster,
 * image tag, and health — NOT the IAM/OAuth "application" registry (that is an identity
 * concern, not compute).
 *
 * Customer-appropriate + honest by construction: a customer isn't a control-plane admin,
 * so `/paas` 403s → the CONNECTED "managed by Hanzo" state (their apps run on managed
 * Hanzo Cloud; deploy via Functions/Agents), never a fabricated grid and never a scary
 * error. A global admin sees the real deployed-app fleet; an empty fleet is an honest
 * "nothing deployed yet" state.
 */
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { Box, ExternalLink, RefreshCw } from '@hanzogui/lucide-icons-2'

import { PlatformApi, type PlatformApp } from '~/lib/api'
import { PageHeader } from '~/components/ui/PageHeader'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { EmptyState } from '~/components/ui/EmptyState'
import { StatusTag } from '~/components/ui/StatusTag'
import { interpretPlatformError, PlatformStateCard, type PlatformError } from './platform/state'

const DASH = '—'

export function ApplicationsModule(_props: { params: Record<string, string> }) {
  const router = useRouter()
  const [apps, setApps] = useState<PlatformApp[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<PlatformError | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await PlatformApi.apps()
      setApps(data ?? [])
      setError(null)
    } catch (e) {
      setApps([])
      setError(interpretPlatformError(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const columns: Column<PlatformApp>[] = [
    {
      key: 'app',
      header: 'Application',
      render: (a) => (
        <XStack items="center" gap="$2" minW={0}>
          <Box size={15} color="$color10" />
          <YStack minW={0}>
            <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>{a.app || a.id}</Text>
            <Text fontSize="$1" color="$color10" numberOfLines={1}>{a.namespace || a.org}</Text>
          </YStack>
        </XStack>
      ),
    },
    { key: 'env', header: 'Environment', width: 120, render: (a) => <Text fontSize="$3" color="$color11">{a.env || DASH}</Text> },
    { key: 'cluster', header: 'Cluster', width: 150, render: (a) => <Text fontSize="$3" color="$color11" numberOfLines={1}>{a.cluster || DASH}</Text> },
    { key: 'tag', header: 'Version', width: 130, render: (a) => <Text fontSize="$2" color="$color11" numberOfLines={1}>{a.runningTag || a.declaredTag || DASH}</Text> },
    { key: 'health', header: 'Health', width: 110, render: (a) => <StatusTag status={a.health ?? 'unknown'} /> },
  ]

  const header = (
    <PageHeader
      title="Applications"
      subtitle="Your deployed application services."
      actions={
        <Button size="$3" icon={<RefreshCw size={15} />} onPress={() => void load()} aria-label="Refresh">
          <Text display="none" $md={{ display: 'flex' }}>Refresh</Text>
        </Button>
      }
    />
  )

  if (loading) {
    return (
      <>
        {header}
        <XStack p="$6" justify="center"><Spinner size="large" color="$color11" /></XStack>
      </>
    )
  }

  // A customer isn't a control-plane admin → the CONNECTED "managed by Hanzo" state
  // (their apps run on managed Hanzo Cloud), never the infra token message.
  if (error) {
    return (
      <>
        {header}
        <PlatformStateCard error={error} onRetry={() => void load()} />
        <XStack gap="$2" flexWrap="wrap">
          <Button size="$2" icon={<ExternalLink size={14} />} onPress={() => router.push('/functions')}>Deploy a Function</Button>
          <Button size="$2" icon={<ExternalLink size={14} />} onPress={() => router.push('/agents')}>Deploy an Agent</Button>
        </XStack>
      </>
    )
  }

  if (apps.length === 0) {
    return (
      <>
        {header}
        <EmptyState
          icon={Box}
          title="No applications deployed yet"
          description="Deployed application services show up here with their environment, cluster, image tag, and health. Deploy from source, or run serverless Functions and Agents."
          primary={{ label: 'Deploy a Function', onPress: () => router.push('/functions') }}
          secondary={{ label: 'Deploy an Agent', onPress: () => router.push('/agents') }}
        />
      </>
    )
  }

  return (
    <>
      {header}
      <DataTable columns={columns} rows={apps} rowKey={(a) => a.id} empty="No applications deployed yet." />
    </>
  )
}
