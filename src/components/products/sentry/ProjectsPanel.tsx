'use client'

/**
 * Projects — the client identities errors/logs/traces ingest under
 * (`/v1/sentry/projects`). List, create (returns a DSN — shown with the paste-ready
 * SDK snippet), and rotate the ingest key. The DSN is the CLEAN path
 * `https://<key>@api.hanzo.ai/v1/sentry/<project>` (NO `/api/` segment); the SDK
 * derives its ingest endpoint as `/v1/sentry/<project>/envelope/`. Honest states —
 * a create/rotate failure surfaces the real error, never a fabricated key.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { KeyRound, Plus, RefreshCw } from '@hanzogui/lucide-icons-2'

import { SentryApi, type SentryProject } from '~/lib/api/sentry'
import { SlideOver } from '~/components/ui/SlideOver'
import { ErrorState, asApiError } from '~/components/ui/States'
import { CodeBlock, Fact } from './parts'
import { fmtWhen, fmtDateTime, fmtCount, sdkSnippet, ingestUrl } from './logic'
import { toneColor } from '~/components/ui/tone'
import { DataTable, FieldRow, FieldSelect, FieldText, PageHeader, PrimaryButton, type Column } from '@hanzo/ui/product'

const PLATFORMS = ['javascript', 'node', 'python', 'go', 'ruby', 'java', 'php', 'rust', 'dotnet', 'other']

type State = { phase: 'loading' } | { phase: 'error'; error: unknown } | { phase: 'ready'; projects: SentryProject[] }

export function ProjectsPanel() {
  const [state, setState] = useState<State>({ phase: 'loading' })
  const [detail, setDetail] = useState<SentryProject | null>(null)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [platform, setPlatform] = useState('javascript')
  const [busy, setBusy] = useState(false)
  const [createErr, setCreateErr] = useState('')

  const load = useCallback(async () => {
    setState({ phase: 'loading' })
    try {
      setState({ phase: 'ready', projects: await SentryApi.projects() })
    } catch (e) {
      setState({ phase: 'error', error: e })
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const open = async (id: string) => {
    try {
      setDetail(await SentryApi.project(id))
    } catch {
      // Fall back to the list row (no DSN) rather than a blank rail.
      const row = state.phase === 'ready' ? state.projects.find((p) => p.id === id) : null
      if (row) setDetail(row)
    }
  }

  const create = async () => {
    if (!name.trim()) return
    setBusy(true)
    setCreateErr('')
    try {
      const p = await SentryApi.createProject(name.trim(), platform)
      setCreating(false)
      setName('')
      setDetail(p) // the created project carries its DSN
      void load()
    } catch (e) {
      setCreateErr(asApiError(e).message)
    } finally {
      setBusy(false)
    }
  }

  const rotate = async () => {
    if (!detail) return
    setBusy(true)
    try {
      const dsn = await SentryApi.rotateKey(detail.id)
      setDetail((d) => (d ? { ...d, dsn } : d))
    } catch {
      /* keep the current DSN on failure */
    } finally {
      setBusy(false)
    }
  }

  const projects = state.phase === 'ready' ? state.projects : []

  const columns: Column<SentryProject>[] = [
    { key: 'name', header: 'Project', render: (p) => (
      <YStack minW={0}>
        <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>{p.name || p.slug}</Text>
        <Text fontSize="$1" color="$color10" numberOfLines={1} className="hz-mono">{p.slug || p.id}</Text>
      </YStack>
    ) },
    { key: 'platform', header: 'Platform', width: 130, render: (p) => <Text fontSize="$2" color="$color11">{p.platform || '—'}</Text> },
    { key: 'eventCount', header: 'Events', width: 90, align: 'right', mono: true, render: (p) => <Text className="hz-mono">{p.eventCount ? fmtCount(p.eventCount) : '—'}</Text> },
    { key: 'lastEvent', header: 'Last event', width: 120, render: (p) => <Text fontSize="$2" color="$color11">{p.lastEvent ? fmtWhen(p.lastEvent) : '—'}</Text> },
    { key: 'dateCreated', header: 'Created', width: 130, render: (p) => <Text fontSize="$2" color="$color11">{p.dateCreated ? fmtDateTime(p.dateCreated) : '—'}</Text> },
  ]

  return (
    <YStack gap="$4">
      <PageHeader
        title="Projects"
        subtitle="A project is a client your errors, logs, and traces ingest under. Create one to get a DSN."
        actions={
          <XStack gap="$2">
            <Button size="$3" icon={<RefreshCw size={15} />} onPress={() => void load()}>
              Refresh
            </Button>
            <PrimaryButton size="$3" icon={<Plus size={15} />} onPress={() => { setCreating(true); setCreateErr('') }}>
              New project
            </PrimaryButton>
          </XStack>
        }
      />

      {state.phase === 'error' ? (
        <ErrorState err={asApiError(state.error)} onRetry={() => void load()} />
      ) : (
        <DataTable<SentryProject>
          columns={columns}
          rows={projects}
          loading={state.phase === 'loading'}
          rowKey={(p) => p.id}
          onRowPress={(p) => void open(p.id)}
          empty="No projects yet. Create one to get a DSN and start sending events."
        />
      )}

      {/* Create rail */}
      <SlideOver open={creating} onClose={() => setCreating(false)} title="New project" icon={Plus} size={460}>
        <YStack gap="$3">
          <FieldRow label="Name">
            <FieldText value={name} onChange={setName} placeholder="e.g. web-app" />
          </FieldRow>
          <FieldRow label="Platform">
            <FieldSelect value={platform} options={PLATFORMS} onChange={setPlatform} />
          </FieldRow>
          {createErr ? (
            <Text fontSize="$2" color={toneColor('critical')}>
              {createErr}
            </Text>
          ) : null}
          <XStack gap="$2">
            <PrimaryButton onPress={() => void create()} disabled={busy || !name.trim()} icon={busy ? <Spinner size="small" /> : <Plus size={15} />}>
              Create project
            </PrimaryButton>
            <Button chromeless onPress={() => setCreating(false)}>
              Cancel
            </Button>
          </XStack>
        </YStack>
      </SlideOver>

      {/* Detail rail — DSN + SDK snippet + rotate */}
      <SlideOver open={detail !== null} onClose={() => setDetail(null)} title={detail?.name || 'Project'} icon={KeyRound} size={560}>
        {detail ? (
          <YStack gap="$3.5">
            <XStack gap="$4" flexWrap="wrap">
              <Fact label="Slug" value={detail.slug || detail.id} />
              <Fact label="Platform" value={detail.platform || '—'} />
              <Fact label="Events" value={detail.eventCount ? fmtCount(detail.eventCount) : '—'} />
              <Fact label="Last event" value={detail.lastEvent ? fmtWhen(detail.lastEvent) : '—'} />
            </XStack>

            {detail.dsn ? (
              <>
                <CodeBlock title="DSN" code={detail.dsn} />
                {ingestUrl(detail.dsn) ? (
                  <Fact label="Ingest endpoint" value={ingestUrl(detail.dsn)} />
                ) : null}
                <YStack gap="$1.5">
                  <Text fontSize="$2" color="$color11" fontWeight="600">
                    Add to your app
                  </Text>
                  <CodeBlock title="SDK" code={sdkSnippet(detail.dsn)} />
                </YStack>
                <XStack>
                  <Button size="$2.5" icon={busy ? <Spinner size="small" /> : <RefreshCw size={15} />} onPress={() => void rotate()} disabled={busy}>
                    Rotate key
                  </Button>
                </XStack>
                <Text fontSize="$1" color="$color10">
                  Rotating the key issues a new DSN and invalidates the old one — update your SDK config after rotating.
                </Text>
              </>
            ) : (
              <Card p="$4" borderWidth={1} borderColor="$borderColor">
                <Text fontSize="$2" color="$color11">
                  This project’s DSN isn’t available on this view. Rotate the key to issue a fresh DSN.
                </Text>
                <XStack mt="$2">
                  <Button size="$2.5" icon={<RefreshCw size={15} />} onPress={() => void rotate()} disabled={busy}>
                    Issue a DSN
                  </Button>
                </XStack>
              </Card>
            )}
          </YStack>
        ) : null}
      </SlideOver>
    </YStack>
  )
}
