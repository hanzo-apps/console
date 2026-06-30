'use client'

/**
 * Agents — autonomous agent definitions and their runs, registered and executed
 * by the platform.
 *
 * Reads the agent registry from the PaaS via the same-origin `/paas` proxy
 * (`GET /v1/agents`), which injects the service token server-side. When the agent
 * service isn't provisioned for the org the list load fails and the honest
 * not-configured / unavailable card renders instead of an empty grid — matching
 * every other infra module.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Text } from '@hanzo/gui'
import { Bot, RefreshCw } from '@hanzogui/lucide-icons-2'

import { restGet } from '~/lib/api/client'
import { PageHeader } from '~/components/ui/PageHeader'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { EmptyState } from '~/components/ui/EmptyState'
import { StatusTag } from '~/components/ui/StatusTag'
import { interpretPlatformError, PlatformStateCard, type PlatformError } from './platform/state'

const paas = (path: string) => `/paas/${path.replace(/^\/+/, '')}`
const DOCS = 'https://docs.hanzo.ai/agents'

type Agent = {
  id: string
  name?: string
  model?: string
  status?: string
  runs?: number
  updatedAt?: string
}

export function AgentsModule(_props: { params: Record<string, string> }) {
  const [rows, setRows] = useState<Agent[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<PlatformError | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await restGet<{ agents?: Agent[] }>(paas('agents'))
      setRows(r.agents ?? [])
      setLoadError(null)
    } catch (e) {
      setLoadError(interpretPlatformError(e))
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const columns: Column<Agent>[] = [
    {
      key: 'name',
      header: 'Name',
      render: (a) => (
        <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>
          {a.name || a.id}
        </Text>
      ),
    },
    {
      key: 'model',
      header: 'Model',
      width: 180,
      render: (a) => (
        <Text fontSize="$3" color="$color11">
          {a.model || '—'}
        </Text>
      ),
    },
    {
      key: 'runs',
      header: 'Runs',
      width: 90,
      render: (a) => (
        <Text fontSize="$3" color="$color11">
          {a.runs ?? '—'}
        </Text>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: 120,
      render: (a) => <StatusTag status={a.status ?? 'unknown'} />,
    },
    {
      key: 'updatedAt',
      header: 'Updated',
      width: 190,
      render: (a) => (
        <Text fontSize="$3" color="$color11">
          {a.updatedAt ? new Date(a.updatedAt).toLocaleString() : '—'}
        </Text>
      ),
    },
  ]

  return (
    <>
      <PageHeader
        title="Agents"
        subtitle="Autonomous agent definitions and runs."
        actions={
          <Button icon={<RefreshCw size={16} />} onPress={() => void load()}>
            Refresh
          </Button>
        }
      />

      {loadError ? (
        <PlatformStateCard error={loadError} onRetry={() => void load()} />
      ) : !loading && rows.length === 0 ? (
        <EmptyState
          icon={Bot}
          title="Deploy your first agent"
          description="Agents are autonomous workers — a model, a system prompt, and a set of tools that run on Hanzo compute and call your APIs on their own."
          bullets={[
            'Define an agent with the hanzo CLI or the Agents SDK',
            'Give it tools (HTTP, MCP servers, your own functions)',
            'Deploy to Hanzo compute — runs and logs show up here',
          ]}
          primary={{ label: 'Deploy an agent', href: DOCS }}
          secondary={{ label: 'Agents SDK docs', href: 'https://docs.hanzo.ai/sdk' }}
        />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          loading={loading}
          rowKey={(a) => a.id}
          empty="No agents yet."
        />
      )}
    </>
  )
}
