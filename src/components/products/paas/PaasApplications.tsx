'use client'

/**
 * Applications — the org's REAL deployed apps on the live Hanzo PaaS
 * (`/v1/platform/*` via the `/cloud` bearer proxy). Per-org by construction:
 * cloud resolves the org from the Bearer owner, so the caller only ever sees
 * THEIR projects/apps. Lists every app with its project, status, source, and live
 * URL; deploys a new app (git repo or image) and — the marquee — lets a customer
 * WATCH it move Queued → Building → Deploying → Live on the animated RailwayDeploy
 * pipeline (real deployment status, not decorative); and opens an app to its
 * pipeline + deployment history + build status + a redeploy.
 *
 * Honest states, never fabricated rows: loading, sign-in (401), managed/forbidden
 * (403), PaaS-not-wired (404), empty ("deploy your first app"). Real data or an
 * honest state — never a placeholder grid.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Card, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { Box, ExternalLink, Plus, RefreshCw, Rocket } from '@hanzogui/lucide-icons-2'

import { PaasApi, type PaasAppWithProject, type PaasDeployment, type PaasProject } from '~/lib/api/paas'
import { PageHeader } from '~/components/ui/PageHeader'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { EmptyState } from '~/components/ui/EmptyState'
import { StatusTag } from '~/components/ui/StatusTag'
import { PrimaryButton } from '~/components/ui/PrimaryButton'
import { FieldRow, FieldText, FieldSelect } from '~/components/ui/Field'
import { appUrl, appSource, orderDeployments, buildStatusOf, deploymentLabel, classifyPaasError } from './logic'
import { DomainsPanel } from './DomainsPanel'
import { RailwayDeploy } from './RailwayDeploy'

const openUrl = (href: string) => {
  if (typeof window !== 'undefined') window.open(href, '_blank', 'noopener')
}

type State =
  | { phase: 'loading' }
  | { phase: 'error'; kind: ReturnType<typeof classifyPaasError>['kind']; message: string }
  | { phase: 'ready'; apps: PaasAppWithProject[]; projects: PaasProject[] }

export function PaasApplications(_props: { params: Record<string, string> }) {
  const [state, setState] = useState<State>({ phase: 'loading' })
  const [selected, setSelected] = useState<PaasAppWithProject | null>(null)
  const [showNew, setShowNew] = useState(false)

  const load = useCallback(async () => {
    setState({ phase: 'loading' })
    try {
      const [projects, apps] = await Promise.all([PaasApi.listProjects(), PaasApi.listAllApps()])
      setState({ phase: 'ready', apps, projects })
    } catch (e) {
      const { kind, message } = classifyPaasError(e)
      setState({ phase: 'error', kind, message })
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const columns: Column<PaasAppWithProject>[] = useMemo(
    () => [
      {
        key: 'app',
        header: 'Application',
        render: (a) => (
          <XStack items="center" gap="$2" minW={0}>
            <Box size={15} color="$color10" />
            <YStack minW={0}>
              <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>{a.name || a.slug}</Text>
              <Text fontSize="$1" color="$color10" numberOfLines={1}>{a.project.name || a.project.slug} · {a.environment || '—'}</Text>
            </YStack>
          </XStack>
        ),
      },
      { key: 'source', header: 'Source', render: (a) => <Text fontSize="$2" color="$color11" numberOfLines={1}>{appSource(a)}</Text> },
      { key: 'status', header: 'Status', width: 120, render: (a) => <StatusTag status={a.status ?? a.phase ?? 'unknown'} /> },
      {
        key: 'url',
        header: 'URL',
        width: 150,
        render: (a) => {
          const url = appUrl(a)
          return url ? (
            <Button size="$1" chromeless icon={<ExternalLink size={13} />} onPress={() => openUrl(url)}>
              <Text fontSize="$2" color="$color11" numberOfLines={1}>Open</Text>
            </Button>
          ) : (
            <Text fontSize="$2" color="$color10">—</Text>
          )
        },
      },
    ],
    [],
  )

  const header = (
    <PageHeader
      title="Applications"
      subtitle="Your deployed apps on Hanzo PaaS — per organization."
      actions={
        <XStack gap="$2">
          <Button size="$3" icon={<RefreshCw size={15} />} onPress={() => void load()} aria-label="Refresh" />
          <PrimaryButton size="$3" icon={<Plus size={16} />} onPress={() => { setShowNew(true); setSelected(null) }}>
            New app
          </PrimaryButton>
        </XStack>
      }
    />
  )

  if (state.phase === 'loading') {
    return (
      <>
        {header}
        <XStack p="$6" justify="center"><Spinner size="large" color="$color11" /></XStack>
      </>
    )
  }

  if (state.phase === 'error') {
    return (
      <>
        {header}
        <ErrorCard kind={state.kind} message={state.message} onRetry={() => void load()} />
      </>
    )
  }

  return (
    <>
      {header}

      {showNew ? (
        <NewAppForm
          projects={state.projects}
          onCancel={() => setShowNew(false)}
          onDeployed={() => { setShowNew(false); void load() }}
        />
      ) : null}

      {state.apps.length === 0 && !showNew ? (
        <EmptyState
          icon={Rocket}
          title="Deploy your first app"
          description="Ship a git repo or a container image to Hanzo PaaS. Your deployed apps appear here with their status, source, and live URL — per organization."
          primary={{ label: 'New app', onPress: () => setShowNew(true) }}
        />
      ) : (
        <XStack gap="$4" flexWrap="wrap" items="flex-start">
          <YStack flex={2} minW={320} gap="$2">
            <DataTable
              columns={columns}
              rows={state.apps}
              rowKey={(a) => a.id}
              onRowPress={(a) => setSelected(a)}
              empty="No apps deployed yet."
            />
          </YStack>
          {selected ? (
            <YStack flex={1} minW={300}>
              <AppDetail app={selected} onClose={() => setSelected(null)} onChanged={() => void load()} />
            </YStack>
          ) : null}
        </XStack>
      )}
    </>
  )
}

function ErrorCard({ kind, message, onRetry }: { kind: ReturnType<typeof classifyPaasError>['kind']; message: string; onRetry: () => void }) {
  const copy =
    kind === 'signin'
      ? { title: 'Sign in to see your apps', body: 'Your session isn’t authenticated for the platform. Sign in to view and deploy your apps.' }
      : kind === 'forbidden'
        ? { title: 'Connected · managed by Hanzo', body: 'The platform is reachable but this action needs additional access. Your apps run on managed Hanzo Cloud.' }
        : kind === 'unavailable'
          ? { title: 'Platform not wired on this deployment', body: 'The PaaS control plane (/v1/platform) isn’t routed on this deployment yet. Your apps appear here automatically once it is.' }
          : { title: 'Could not reach the platform', body: message || 'Retry, or check back shortly.' }
  return (
    <Card p="$4" gap="$2" borderWidth={1} borderColor="$borderColor" maxWidth={640}>
      <Text fontSize="$4" fontWeight="700">{copy.title}</Text>
      <Text fontSize="$3" color="$color11">{copy.body}</Text>
      <Button size="$2" self="flex-start" onPress={onRetry}>Retry</Button>
    </Card>
  )
}

// ── New app (deploy) flow ─────────────────────────────────────────────────────

type Deploying =
  | { phase: 'idle' }
  | { phase: 'working'; step: string }
  | { phase: 'error'; message: string }
  | { phase: 'watching'; project: string; app: string }
const NEW_PROJECT = '➕ New project…'

function NewAppForm({ projects, onCancel, onDeployed }: { projects: PaasProject[]; onCancel: () => void; onDeployed: () => void }) {
  const options = useMemo(() => [...projects.map((p) => p.name || p.slug), NEW_PROJECT], [projects])
  const [projectChoice, setProjectChoice] = useState(options[0] ?? NEW_PROJECT)
  const [newProjectName, setNewProjectName] = useState('')
  const [appName, setAppName] = useState('')
  const [source, setSource] = useState<'git' | 'image'>('git')
  const [repoUrl, setRepoUrl] = useState('')
  const [branch, setBranch] = useState('main')
  const [imageRepo, setImageRepo] = useState('')
  const [imageTag, setImageTag] = useState('latest')
  const [state, setState] = useState<Deploying>({ phase: 'idle' })

  const creatingProject = projectChoice === NEW_PROJECT || projects.length === 0
  const valid =
    appName.trim() !== '' &&
    (creatingProject ? newProjectName.trim() !== '' : true) &&
    (source === 'git' ? repoUrl.trim() !== '' : imageRepo.trim() !== '')

  const deploy = async () => {
    if (!valid) return
    try {
      setState({ phase: 'working', step: 'Preparing project…' })
      let projectSlug: string
      if (creatingProject) {
        const p = await PaasApi.createProject({ name: newProjectName.trim() })
        projectSlug = p.slug || p.id
      } else {
        const chosen = projects.find((p) => (p.name || p.slug) === projectChoice)
        projectSlug = chosen?.slug || chosen?.id || projectChoice
      }

      setState({ phase: 'working', step: 'Creating app…' })
      const app = await PaasApi.createApp(projectSlug, {
        name: appName.trim(),
        source,
        ...(source === 'git'
          ? { repo: { url: repoUrl.trim(), branch: branch.trim() || 'main' } }
          : { image: { repository: imageRepo.trim(), tag: imageTag.trim() || 'latest' } }),
      })

      setState({ phase: 'working', step: 'Deploying…' })
      await PaasApi.deploy(projectSlug, app.slug || app.id, source === 'image' ? { tag: imageTag.trim() || 'latest' } : {})
      // Hand off to the live pipeline — watch it go Queued → Building → Deploying → Live.
      setState({ phase: 'watching', project: projectSlug, app: app.slug || app.id })
    } catch (e) {
      const { kind, message } = classifyPaasError(e)
      setState({
        phase: 'error',
        message:
          kind === 'signin'
            ? 'Sign in to deploy apps.'
            : kind === 'forbidden'
              ? 'Deploying requires platform access for your organization.'
              : message || 'Deploy failed. Check the inputs and retry.',
      })
    }
  }

  if (state.phase === 'watching') {
    return <DeployWatch project={state.project} app={state.app} onDone={onDeployed} />
  }

  const busy = state.phase === 'working'
  return (
    <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor" maxWidth={720}>
      <XStack items="center" justify="space-between">
        <Text fontSize="$5" fontWeight="700">New app</Text>
        <Button size="$2" onPress={onCancel} disabled={busy}>Cancel</Button>
      </XStack>

      <FieldRow label="Project">
        {projects.length > 0 ? (
          <FieldSelect value={projectChoice} options={options} onChange={setProjectChoice} disabled={busy} />
        ) : (
          <FieldText value={newProjectName} onChange={setNewProjectName} disabled={busy} placeholder="my-project" />
        )}
      </FieldRow>
      {creatingProject && projects.length > 0 ? (
        <FieldRow label="New project name">
          <FieldText value={newProjectName} onChange={setNewProjectName} disabled={busy} placeholder="my-project" />
        </FieldRow>
      ) : null}

      <FieldRow label="App name">
        <FieldText value={appName} onChange={setAppName} disabled={busy} placeholder="web" />
      </FieldRow>

      <FieldRow label="Source">
        <XStack gap="$2">
          {(['git', 'image'] as const).map((s) => (
            <Button key={s} size="$2" bg={source === s ? '$color5' : 'transparent'} borderWidth={1} borderColor="$borderColor" onPress={() => setSource(s)} disabled={busy}>
              {s === 'git' ? 'Git repo' : 'Container image'}
            </Button>
          ))}
        </XStack>
      </FieldRow>

      {source === 'git' ? (
        <>
          <FieldRow label="Repository URL">
            <FieldText value={repoUrl} onChange={setRepoUrl} disabled={busy} placeholder="https://github.com/org/repo" />
          </FieldRow>
          <FieldRow label="Branch">
            <FieldText value={branch} onChange={setBranch} disabled={busy} placeholder="main" />
          </FieldRow>
        </>
      ) : (
        <>
          <FieldRow label="Image repository">
            <FieldText value={imageRepo} onChange={setImageRepo} disabled={busy} placeholder="ghcr.io/org/app" />
          </FieldRow>
          <FieldRow label="Tag">
            <FieldText value={imageTag} onChange={setImageTag} disabled={busy} placeholder="latest" />
          </FieldRow>
        </>
      )}

      {state.phase === 'error' ? <Text fontSize="$2" color="$red10">{state.message}</Text> : null}

      <XStack items="center" gap="$3">
        <PrimaryButton size="$3" icon={busy ? <Spinner size="small" /> : <Rocket size={16} />} onPress={deploy} disabled={!valid || busy}>
          {busy ? state.step : 'Deploy'}
        </PrimaryButton>
        <Text fontSize="$1" color="$color10">
          {source === 'git' ? 'Builds from source in-cluster (BuildKit), then goes live.' : 'Applies the image and goes live.'}
        </Text>
      </XStack>
    </Card>
  )
}

/** The live pipeline hand-off — watch the just-deployed app reach Live in real time. */
function DeployWatch({ project, app, onDone }: { project: string; app: string; onDone: () => void }) {
  const [live, setLive] = useState(false)
  return (
    <Card p="$4" gap="$3.5" borderWidth={1} borderColor="$borderColor" maxWidth={720}>
      <XStack items="center" justify="space-between" gap="$3">
        <Text fontSize="$5" fontWeight="700">{live ? 'Your app is live' : 'Deploying your app'}</Text>
        <PrimaryButton size="$2" onPress={onDone}>{live ? 'View apps' : 'Run in background'}</PrimaryButton>
      </XStack>
      <RailwayDeploy projectSlug={project} appSlug={app} status="queued" onLive={() => setLive(true)} />
      <Text fontSize="$1" color="$color10">
        {live
          ? 'It appears in your apps list with its status, source, and live URL.'
          : 'This tracks the live deployment status — Queued → Building → Deploying → Live.'}
      </Text>
    </Card>
  )
}

// ── App detail (live pipeline + deployment history + build status + redeploy) ──

type DetailState =
  | { phase: 'loading' }
  | { phase: 'error'; message: string }
  | { phase: 'ready'; deployments: PaasDeployment[] }

function AppDetail({ app, onClose, onChanged }: { app: PaasAppWithProject; onClose: () => void; onChanged: () => void }) {
  const projectSlug = app.project.slug || app.project.id
  const appSlug = app.slug || app.id
  const [state, setState] = useState<DetailState>({ phase: 'loading' })
  const [redeploy, setRedeploy] = useState<'idle' | 'working' | 'error'>('idle')
  // Bumped on redeploy so the pipeline remounts and re-tracks from Queued.
  const [nonce, setNonce] = useState(0)

  const load = useCallback(async () => {
    setState({ phase: 'loading' })
    try {
      const deployments = orderDeployments(await PaasApi.listDeployments(projectSlug, appSlug))
      setState({ phase: 'ready', deployments })
    } catch (e) {
      setState({ phase: 'error', message: classifyPaasError(e).message })
    }
  }, [projectSlug, appSlug])

  useEffect(() => {
    void load()
  }, [load])

  const doRedeploy = async () => {
    setRedeploy('working')
    try {
      await PaasApi.deploy(projectSlug, appSlug, app.source === 'image' ? { tag: app.image?.tag } : {})
      setRedeploy('idle')
      setNonce((k) => k + 1) // restart the pipeline animation from Queued
    } catch {
      setRedeploy('error')
    }
  }

  const url = appUrl(app)
  return (
    <Card p="$3.5" gap="$3" borderWidth={1} borderColor="$borderColor">
      <XStack items="center" justify="space-between">
        <Text fontSize="$4" fontWeight="800" numberOfLines={1}>{app.name || app.slug}</Text>
        <Button size="$1" chromeless onPress={onClose} aria-label="Close">✕</Button>
      </XStack>

      {/* Live deployment pipeline — real status, animated Building → Deploying → Live. */}
      <YStack pb="$2" borderBottomWidth={1} borderColor="$borderColor">
        <RailwayDeploy
          key={nonce}
          projectSlug={projectSlug}
          appSlug={appSlug}
          status={nonce === 0 ? (app.status ?? app.phase) : 'queued'}
          onLive={() => { void load(); onChanged() }}
        />
      </YStack>

      <YStack gap="$1.5">
        <Fact label="Project" value={app.project.name || app.project.slug} />
        <Fact label="Environment" value={app.environment ?? '—'} />
        <Fact label="Source" value={appSource(app)} />
        <XStack justify="space-between" items="center">
          <Text fontSize="$2" color="$color10" fontWeight="600">Status</Text>
          <StatusTag status={app.status ?? app.phase ?? 'unknown'} />
        </XStack>
      </YStack>

      <XStack gap="$2" flexWrap="wrap">
        <PrimaryButton size="$2" icon={redeploy === 'working' ? <Spinner size="small" /> : <Rocket size={14} />} onPress={doRedeploy} disabled={redeploy === 'working'}>
          {redeploy === 'working' ? 'Redeploying…' : 'Redeploy'}
        </PrimaryButton>
        {url ? (
          <Button size="$2" icon={<ExternalLink size={14} />} onPress={() => openUrl(url)}>Open</Button>
        ) : null}
      </XStack>
      {redeploy === 'error' ? <Text fontSize="$2" color="$red10">Redeploy failed. Retry.</Text> : null}

      <DomainsPanel projectSlug={projectSlug} appSlug={appSlug} />

      <YStack gap="$2" pt="$1" borderTopWidth={1} borderColor="$borderColor">
        <Text fontSize="$3" fontWeight="700">Deployments</Text>
        {state.phase === 'loading' ? (
          <XStack gap="$2" items="center"><Spinner size="small" /><Text fontSize="$2" color="$color10">Loading…</Text></XStack>
        ) : state.phase === 'error' ? (
          <Text fontSize="$2" color="$color10">Couldn’t load deployments.</Text>
        ) : state.deployments.length === 0 ? (
          <Text fontSize="$2" color="$color10">No deployments yet.</Text>
        ) : (
          state.deployments.slice(0, 12).map((d) => {
            const build = buildStatusOf(d)
            return (
              <XStack key={d.id} items="center" justify="space-between" gap="$2" py="$1">
                <YStack minW={0} flex={1}>
                  <Text fontSize="$2" fontWeight="600" numberOfLines={1}>{deploymentLabel(d)}{d.commit ? ` · ${d.commit.slice(0, 7)}` : ''}</Text>
                  {build ? <Text fontSize="$1" color="$color10">build: {build}</Text> : null}
                </YStack>
                <StatusTag status={d.status ?? 'unknown'} />
              </XStack>
            )
          })
        )}
      </YStack>
    </Card>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <XStack justify="space-between" gap="$3">
      <Text fontSize="$2" color="$color10" fontWeight="600">{label}</Text>
      <Text fontSize="$2" color="$color12" numberOfLines={1}>{value}</Text>
    </XStack>
  )
}
