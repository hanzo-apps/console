'use client'

/**
 * Base — your organization's realtime backend (hanzoai/base), embedded in the ONE
 * cloud binary and served natively, same-origin, at /v1/base.
 *
 * THE ORG IS THE TENANT. Each IAM org — including a user's personal/default org —
 * gets its own physically-isolated Base, scoped by the validated IAM principal
 * (X-Org-Id from the JWT owner). There is no `tenants` collection, no orchestrator,
 * no per-Base `<slug>.base.hanzo.ai` workload: that was incidental complexity. One
 * IAM org ↔ one Base. Switching tenant = switching org (the sidebar org switcher).
 *
 * This surface is the org's Base overview — its content types (collections).
 * Browsing and editing records is the sibling `Records` product (also on /v1/base).
 */
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useOrganizations } from '@hanzo/iam/react'
import { Button, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { Boxes, Database, Table2 } from '@hanzogui/lucide-icons-2'

import { PageHeader } from '@hanzo/ui/product'
import { PrimaryButton } from '@hanzo/ui/product'
import { EmptyState } from '@hanzo/ui/product'
import { BackendStateCard, classifyBackend, type BackendState } from '@hanzo/ui/product'
import { BaseDataApi } from '~/lib/base-data/api'

/** The org's Base is served natively same-origin by the cloud binary at /v1/base
 *  (per-org, org resolved from the validated IAM principal — CLOUD_BASE_EMBED). */
const BASE_ROOT = '/v1/base'

type Collection = { name: string }
type State =
  | { phase: 'loading' }
  | { phase: 'error'; error: BackendState }
  | { phase: 'ready'; collections: Collection[] }

export function BaseModule(_props: { params: Record<string, string> }) {
  const router = useRouter()
  const { currentOrg, currentOrgId } = useOrganizations()
  const api = useMemo(() => new BaseDataApi({ baseUrl: BASE_ROOT }), [])
  const [state, setState] = useState<State>({ phase: 'loading' })

  useEffect(() => {
    let cancelled = false
    setState({ phase: 'loading' })
    api
      .listCollections()
      .then((cols) => {
        // Hide the engine's internal collections (_superusers, _views, …).
        const visible = cols.filter((c): c is Collection => typeof c.name === 'string' && !c.name.startsWith('_'))
        if (!cancelled) setState({ phase: 'ready', collections: visible })
      })
      .catch((e) => {
        if (!cancelled) setState({ phase: 'error', error: classifyBackend(e) })
      })
    return () => {
      cancelled = true
    }
  }, [api, currentOrgId])

  const orgName = currentOrg?.name ?? 'your organization'

  return (
    <YStack gap="$4">
      <PageHeader
        title="Base"
        subtitle={`${orgName}'s realtime backend — content types, records, and auth, isolated to this organization.`}
        actions={
          <PrimaryButton size="$3" icon={<Table2 size={16} />} onPress={() => router.push('/records')}>
            Open Records
          </PrimaryButton>
        }
      />

      {state.phase === 'error' ? (
        <BackendStateCard state={state.error} onRetry={() => router.refresh()} hint="base · GET /v1/base/collections" />
      ) : state.phase === 'loading' ? (
        <XStack p="$4" gap="$2" items="center">
          <Spinner />
          <Text color="$color11">Loading your Base…</Text>
        </XStack>
      ) : state.collections.length === 0 ? (
        <EmptyState
          icon={Boxes}
          title="No content types yet"
          description={`${orgName}'s Base is ready. Create your first content type in Records to start storing data.`}
          bullets={[
            'One isolated Base per organization — scoped by your IAM org',
            'Model content types (collections) and store records',
            'Every read/write is scoped to this org automatically',
          ]}
          primary={{ label: 'Open Records', onPress: () => router.push('/records'), icon: <Table2 size={16} /> }}
        />
      ) : (
        <YStack gap="$2" maxW={860}>
          <Text fontSize="$3" color="$color10">
            {state.collections.length} content type{state.collections.length === 1 ? '' : 's'}
          </Text>
          {state.collections.map((c) => (
            <XStack
              key={c.name}
              items="center"
              justify="space-between"
              gap="$3"
              borderWidth={1}
              borderColor="$borderColor"
              rounded="$4"
              px="$4"
              py="$3"
              cursor="pointer"
              hoverStyle={{ bg: '$color3', borderColor: '$color7' }}
              onPress={() => router.push('/records')}
            >
              <XStack items="center" gap="$3" flex={1}>
                <Database size={16} />
                <Text fontSize="$4" fontWeight="700">
                  {c.name}
                </Text>
              </XStack>
              <Button
                size="$2"
                chromeless
                onPress={(e) => {
                  e.stopPropagation?.()
                  router.push('/records')
                }}
              >
                Records
              </Button>
            </XStack>
          ))}
        </YStack>
      )}
    </YStack>
  )
}
