'use client'

/**
 * App Platform — the per-org **Hanzo PaaS** over cloud's native `/v1/platform/*`
 * control plane (`hanzoai/cloud` clients/platform). A signed-in org member manages
 * their OWN container apps: list + status, deploy, source-tagged logs, KMS-sealed
 * env (secret-masked), and verified custom domains. Scoped to the caller's org by
 * the Bearer owner claim server-side (the `/v1` proxy) — never a spoofable
 * header.
 *
 * DISTINCT from the admin `applications` module (the `/v1/apps` fleet drift board)
 * and from platform.hanzo.ai (internal-admin). Every state is honest: loading,
 * empty (no apps → point at the CLI/API), and a `BackendStateCard` for a `/v1`
 * failure — never fabricated rows.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { Boxes, Globe, KeyRound, Play, RefreshCw, Rocket, ScrollText, Square } from '@hanzogui/lucide-icons-2'

import {
  PlatformAppsApi,
  type PlatformApp,
  type PlatformDeploymentLogs,
  type PlatformDomain,
  type Sbom,
  type SbomComponent,
} from '~/lib/api/platform-apps'
import { ApiError } from '~/lib/api'
import { BackendStateCard, classifyBackend, type BackendState } from '~/components/ui/BackendState'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { EmptyState } from '~/components/ui/EmptyState'
import { Loader } from '~/components/ui/Loader'
import { PageHeader } from '~/components/ui/PageHeader'
import { PrimaryButton } from '~/components/ui/PrimaryButton'
import { SlideOver } from '~/components/ui/SlideOver'
import { StatusTag } from '~/components/ui/StatusTag'
import {
  appDisplayStatus,
  appImageRef,
  canDeploy,
  isDeployed,
  logSourceLabel,
  maskedEnvRows,
  secretCount,
  secretSyncLabel,
  summarize,
} from './platform-apps/logic'

/** Monospace family for code/env/log text (CSS `style` — not a Gui shorthand prop). */
const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace'

/** SBOM component table columns — Name (mono), Version, Type, License. The shared
 *  DataTable wraps in overflow-x:auto, so it never breaks the 540px SlideOver. */
const sbomColumns: Column<SbomComponent>[] = [
  {
    key: 'name',
    header: 'Name',
    render: (c) => (
      <Text fontSize="$2" numberOfLines={1} style={{ fontFamily: MONO }}>
        {c.name}
      </Text>
    ),
  },
  { key: 'version', header: 'Version', width: 90, render: (c) => <Text fontSize="$2" numberOfLines={1}>{c.version || '—'}</Text> },
  { key: 'type', header: 'Type', width: 90, render: (c) => <Text fontSize="$2" numberOfLines={1}>{c.type || '—'}</Text> },
  { key: 'license', header: 'License', width: 110, render: (c) => <Text fontSize="$2" numberOfLines={1}>{c.license || '—'}</Text> },
]

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card p="$3" gap="$1" borderWidth={1} borderColor="$borderColor" minW={120} flex={1}>
      <Text fontSize="$7" fontWeight="800">
        {value}
      </Text>
      <Text fontSize="$2" color="$color11">
        {label}
      </Text>
    </Card>
  )
}

export function PlatformAppsModule(_props: { params: Record<string, string> }) {
  const [apps, setApps] = useState<PlatformApp[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<BackendState | null>(null)
  const [selected, setSelected] = useState<PlatformApp | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setApps(await PlatformAppsApi.listAllApps())
    } catch (e) {
      setError(classifyBackend(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const sum = summarize(apps)

  const columns: Column<PlatformApp>[] = [
    {
      key: 'name',
      header: 'App',
      render: (a) => (
        <YStack>
          <Text fontSize="$3" fontWeight="600" numberOfLines={1}>
            {a.name}
          </Text>
          <Text fontSize="$1" color="$color10" numberOfLines={1}>
            {a.projectSlug}/{a.slug}
          </Text>
        </YStack>
      ),
    },
    { key: 'source', header: 'Source', width: 90, render: (a) => <Text fontSize="$2">{a.source}</Text> },
    { key: 'status', header: 'Status', width: 120, render: (a) => <StatusTag status={appDisplayStatus(a)} /> },
    {
      key: 'secrets',
      header: 'Secrets',
      width: 130,
      render: (a) => {
        const label = secretSyncLabel(a)
        return label ? <StatusTag status={a.secretSync} /> : <Text fontSize="$2" color="$color10">—</Text>
      },
    },
    {
      key: 'domains',
      header: 'Domains',
      width: 80,
      render: (a) => <Text fontSize="$2">{a.domains?.length ?? 0}</Text>,
    },
  ]

  return (
    <YStack gap="$4" p="$4">
      <PageHeader
        title="App Platform"
        subtitle="Deploy and manage your container apps — projects, deploys, logs, secrets, and domains."
        actions={
          <Button size="$3" icon={RefreshCw} onPress={() => void refresh()} disabled={loading}>
            Refresh
          </Button>
        }
      />

      {error ? (
        <BackendStateCard
          state={error}
          onRetry={() => void refresh()}
          hint="Apps you create with the Hanzo CLI or POST /v1/platform appear here."
        />
      ) : loading ? (
        <Loader label="Loading your apps…" />
      ) : apps.length === 0 ? (
        <EmptyState
          icon={Rocket}
          title="No apps yet"
          description="Create a project and deploy a container app with the Hanzo CLI or the /v1/platform API. Your apps, deploys, logs, secrets, and domains show up here."
          bullets={[
            'Create a project, then an app from a git repo or a prebuilt image',
            'Set env — secret values are sealed in KMS, never plaintext',
            'Add a custom domain and verify it over DNS for automatic TLS',
          ]}
        />
      ) : (
        <>
          <XStack gap="$3" flexWrap="wrap">
            <StatCard label="Apps" value={sum.total} />
            <StatCard label="Live" value={sum.live} />
            <StatCard label="Building" value={sum.building} />
            <StatCard label="Failed" value={sum.failed} />
          </XStack>
          <DataTable<PlatformApp>
            columns={columns}
            rows={apps}
            rowKey={(a) => a.id}
            onRowPress={(a) => setSelected(a)}
          />
        </>
      )}

      <SlideOver open={!!selected} onClose={() => setSelected(null)} title={selected?.name ?? 'App'} size={540}>
        {selected ? (
          <AppDetail app={selected} onChanged={(a) => setSelected(a)} onRefreshList={() => void refresh()} />
        ) : null}
      </SlideOver>
    </YStack>
  )
}

function Fact({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <XStack justify="space-between" items="center" py="$1.5" borderBottomWidth={1} borderColor="$borderColor" gap="$3">
      <Text fontSize="$2" color="$color11">
        {label}
      </Text>
      <Text fontSize="$2" color="$color12" fontWeight="600" numberOfLines={1}>
        {value}
      </Text>
    </XStack>
  )
}

function SectionTitle({ icon: Icon, children }: { icon: typeof Globe; children: React.ReactNode }) {
  return (
    <XStack items="center" gap="$2" mt="$2">
      <Icon size={15} />
      <Text fontSize="$4" fontWeight="700">
        {children}
      </Text>
    </XStack>
  )
}

function AppDetail({
  app,
  onChanged,
  onRefreshList,
}: {
  app: PlatformApp
  onChanged: (a: PlatformApp) => void
  onRefreshList: () => void
}) {
  const project = app.projectSlug ?? ''
  const [busy, setBusy] = useState<string | null>(null)
  const [actErr, setActErr] = useState<string | null>(null)
  const [domains, setDomains] = useState<PlatformDomain[] | null>(null)
  const [logs, setLogs] = useState<PlatformDeploymentLogs | null>(null)
  const [logsLoading, setLogsLoading] = useState(false)
  const [sbom, setSbom] = useState<Sbom | null>(null)
  const [sbomLoading, setSbomLoading] = useState(false)
  const [sbomNote, setSbomNote] = useState<string | null>(null)

  const loadDomains = useCallback(async () => {
    try {
      setDomains(await PlatformAppsApi.listDomains(project, app.slug))
    } catch {
      setDomains([])
    }
  }, [project, app.slug])

  const loadLogs = useCallback(async () => {
    setLogsLoading(true)
    try {
      const deps = await PlatformAppsApi.listDeployments(project, app.slug)
      if (deps.length === 0) {
        setLogs({ deploymentId: '', source: 'none', logs: 'No deployments yet — deploy this app to see build and runtime logs.' })
        return
      }
      setLogs(await PlatformAppsApi.deploymentLogs(project, app.slug, deps[0].id))
    } catch {
      setLogs({ deploymentId: '', source: 'none', logs: 'Logs are not available right now.' })
    } finally {
      setLogsLoading(false)
    }
  }, [project, app.slug])

  const imageRef = appImageRef(app)
  const loadSbom = useCallback(async () => {
    if (!imageRef) {
      setSbom(null)
      setSbomNote(null)
      setSbomLoading(false)
      return
    }
    setSbomLoading(true)
    setSbomNote(null)
    try {
      setSbom(await PlatformAppsApi.sbom(imageRef))
    } catch (e) {
      setSbom(null)
      setSbomNote(
        e instanceof ApiError && e.status === 503 ? 'SBOM datastore unavailable.' : 'Could not load the SBOM.',
      )
    } finally {
      setSbomLoading(false)
    }
  }, [imageRef])

  useEffect(() => {
    void loadDomains()
    void loadLogs()
    void loadSbom()
  }, [loadDomains, loadLogs, loadSbom])

  const act = useCallback(
    async (name: string, fn: () => Promise<PlatformApp>) => {
      setBusy(name)
      setActErr(null)
      try {
        const updated = await fn()
        onChanged({ ...updated, projectSlug: project })
        onRefreshList()
        void loadLogs()
      } catch (e) {
        setActErr(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(null)
      }
    },
    [onChanged, onRefreshList, project, loadLogs],
  )

  const verify = useCallback(
    async (host: string) => {
      setBusy(`verify:${host}`)
      setActErr(null)
      try {
        await PlatformAppsApi.verifyDomain(project, app.slug, host)
        await loadDomains()
      } catch (e) {
        setActErr(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(null)
      }
    },
    [project, app.slug, loadDomains],
  )

  const envRows = maskedEnvRows(app.env)

  return (
    <YStack gap="$3">
      {/* Overview + actions */}
      <XStack gap="$2" flexWrap="wrap">
        <PrimaryButton
          size="$3"
          icon={Rocket}
          disabled={!!busy || !canDeploy(app)}
          onPress={() => void act('deploy', () => PlatformAppsApi.deploy(project, app.slug).then(() => PlatformAppsApi.getApp(project, app.slug)))}
        >
          {busy === 'deploy' ? 'Deploying…' : 'Deploy'}
        </PrimaryButton>
        {isDeployed(app) && app.status !== 'stopped' ? (
          <Button size="$3" icon={Square} disabled={!!busy} onPress={() => void act('stop', () => PlatformAppsApi.stop(project, app.slug))}>
            Stop
          </Button>
        ) : isDeployed(app) ? (
          <Button size="$3" icon={Play} disabled={!!busy} onPress={() => void act('start', () => PlatformAppsApi.start(project, app.slug))}>
            Start
          </Button>
        ) : null}
      </XStack>
      {actErr ? (
        <Text fontSize="$2" color="$red10">
          {actErr}
        </Text>
      ) : null}

      <YStack>
        <Fact label="Status" value={<StatusTag status={appDisplayStatus(app)} />} />
        <Fact label="Environment" value={app.environment} />
        <Fact label="Source" value={app.source} />
        <Fact label="Image" value={app.source === 'image' ? appImageRef(app) || '—' : app.repo?.url || '—'} />
        <Fact label="Replicas" value={app.replicas} />
        <Fact label="Namespace" value={app.namespace || '—'} />
      </YStack>

      {/* Bill of Materials (SBOM) — components CI recorded for this image (cloud clients/sbom) */}
      <SectionTitle icon={Boxes}>
        Bill of Materials (SBOM){sbom ? ` · ${sbom.componentCount} components` : ''}
      </SectionTitle>
      {sbomLoading ? (
        <Spinner size="small" color="$color11" />
      ) : sbomNote ? (
        <Text fontSize="$2" color="$color10">
          {sbomNote}
        </Text>
      ) : sbom && sbom.components.length > 0 ? (
        <DataTable<SbomComponent>
          columns={sbomColumns}
          rows={sbom.components}
          rowKey={(c) => c.purl || `${c.name}@${c.version}`}
        />
      ) : (
        <Text fontSize="$2" color="$color10">
          No SBOM recorded for this image yet.
        </Text>
      )}

      {/* Env (secret-masked) */}
      <SectionTitle icon={KeyRound}>
        Environment {secretCount(app.env) > 0 ? `· ${secretCount(app.env)} secret` : ''}
      </SectionTitle>
      {secretSyncLabel(app) ? (
        <XStack gap="$2" items="center">
          <StatusTag status={app.secretSync} />
          {app.secretSyncDetail ? (
            <Text fontSize="$1" color="$color10" numberOfLines={2}>
              {app.secretSyncDetail}
            </Text>
          ) : null}
        </XStack>
      ) : null}
      {envRows.length === 0 ? (
        <Text fontSize="$2" color="$color10">
          No environment variables.
        </Text>
      ) : (
        <YStack borderWidth={1} borderColor="$borderColor" rounded="$3" overflow="hidden">
          {envRows.map((e) => (
            <XStack key={e.key} py="$2" px="$3" gap="$3" borderBottomWidth={1} borderColor="$borderColor" items="center">
              <Text fontSize="$2" flex={1} numberOfLines={1} style={{ fontFamily: MONO }}>
                {e.key}
              </Text>
              <Text fontSize="$2" color={e.secret ? '$color10' : '$color12'} flex={1} numberOfLines={1} style={{ fontFamily: MONO }}>
                {e.value || '""'}
              </Text>
              {e.secret ? (
                <Text fontSize="$1" color="$color10">
                  secret
                </Text>
              ) : null}
            </XStack>
          ))}
        </YStack>
      )}

      {/* Domains */}
      <SectionTitle icon={Globe}>Domains</SectionTitle>
      {domains === null ? (
        <Spinner size="small" color="$color11" />
      ) : domains.length === 0 ? (
        <Text fontSize="$2" color="$color10">
          No domains.
        </Text>
      ) : (
        <YStack gap="$2">
          {domains.map((d) => (
            <Card key={d.host} p="$3" gap="$2" borderWidth={1} borderColor="$borderColor">
              <XStack justify="space-between" items="center" gap="$2">
                <YStack flex={1}>
                  <Text fontSize="$3" fontWeight="600" numberOfLines={1}>
                    {d.host}
                  </Text>
                  <Text fontSize="$1" color="$color10">
                    {d.kind}
                    {d.primary ? ' · primary' : ''}
                  </Text>
                </YStack>
                <StatusTag status={d.status} />
              </XStack>
              {!d.verified && d.records && d.records.length > 0 ? (
                <YStack gap="$1" bg="$color2" p="$2" rounded="$2">
                  <Text fontSize="$1" color="$color11">
                    {d.detail || 'Publish these DNS records, then verify:'}
                  </Text>
                  {d.records.map((r) => (
                    <Text key={`${r.type}-${r.name}`} fontSize="$1" numberOfLines={1} style={{ fontFamily: MONO }}>
                      {r.type} {r.name} → {r.value}
                    </Text>
                  ))}
                  <Button
                    size="$2"
                    self="flex-start"
                    disabled={busy === `verify:${d.host}`}
                    onPress={() => void verify(d.host)}
                  >
                    {busy === `verify:${d.host}` ? 'Verifying…' : 'Verify'}
                  </Button>
                </YStack>
              ) : null}
            </Card>
          ))}
        </YStack>
      )}

      {/* Source-tagged logs (cloud#75) */}
      <SectionTitle icon={ScrollText}>Logs</SectionTitle>
      <XStack items="center" gap="$2">
        <Text fontSize="$2" color="$color11">
          {logSourceLabel(logs?.source)}
        </Text>
        <Button size="$1" icon={RefreshCw} disabled={logsLoading} onPress={() => void loadLogs()}>
          Refresh
        </Button>
      </XStack>
      <YStack bg="$color1" borderWidth={1} borderColor="$borderColor" rounded="$3" p="$3">
        {logsLoading ? (
          <Spinner size="small" color="$color11" />
        ) : (
          <Text fontSize="$1" color="$color11" style={{ fontFamily: MONO, whiteSpace: 'pre-wrap' }}>
            {logs?.logs || '—'}
          </Text>
        )}
      </YStack>
    </YStack>
  )
}
