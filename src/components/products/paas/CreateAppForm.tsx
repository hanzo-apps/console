'use client'

/**
 * CreateAppForm — the ONE create/deploy flow for a Hanzo PaaS app (git repo or
 * container image). It creates the project if needed, creates the app, kicks the
 * first deploy, then hands off to the live `RailwayDeploy` pipeline so the customer
 * WATCHES it go Queued → Building → Deploying → Live.
 *
 * Shared, DRY: both the Applications board (`PaasApplications`) and the App Platform
 * canvas ("New service") mount this — there is exactly one create path, not two.
 * Pass `projects` when the caller already has them (no refetch); omit them and the
 * form loads its own.
 */
import { useEffect, useMemo, useState } from 'react'
import { Button, Card, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { Rocket } from '@hanzogui/lucide-icons-2'
import { useAnalytics } from '@hanzo/event/react'
import { EVENTS } from '@hanzo/event'

import { PaasApi, type PaasProject } from '~/lib/api/paas'
import { classifyPaasError } from './logic'
import { RailwayDeploy } from './RailwayDeploy'
import { FieldRow, FieldSelect, FieldText, PrimaryButton } from '@hanzo/ui/product'

type Deploying =
  | { phase: 'idle' }
  | { phase: 'working'; step: string }
  | { phase: 'error'; message: string }
  | { phase: 'watching'; project: string; app: string }
const NEW_PROJECT = '➕ New project…'

/** Resolve projects (prop or self-loaded), then render the form once. */
export function CreateAppForm({ projects, onCancel, onDeployed }: { projects?: PaasProject[]; onCancel: () => void; onDeployed: () => void }) {
  const [loaded, setLoaded] = useState<PaasProject[] | null>(projects ?? null)

  useEffect(() => {
    if (projects) {
      setLoaded(projects)
      return
    }
    let live = true
    PaasApi.listProjects()
      .then((p) => live && setLoaded(p))
      .catch(() => live && setLoaded([]))
    return () => {
      live = false
    }
  }, [projects])

  if (loaded === null) {
    return (
      <Card p="$4" borderWidth={1} borderColor="$borderColor" maxWidth={720}>
        <XStack gap="$2" items="center">
          <Spinner size="small" />
          <Text fontSize="$2" color="$color10">
            Loading projects…
          </Text>
        </XStack>
      </Card>
    )
  }
  return <CreateForm projects={loaded} onCancel={onCancel} onDeployed={onDeployed} />
}

function CreateForm({ projects, onCancel, onDeployed }: { projects: PaasProject[]; onCancel: () => void; onDeployed: () => void }) {
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
  const analytics = useAnalytics()

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
        analytics.capture(EVENTS.PROJECT_CREATED)
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
      analytics.capture(EVENTS.APP_CREATED, { source })

      setState({ phase: 'working', step: 'Deploying…' })
      analytics.capture(EVENTS.DEPLOY_STARTED, { source })
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
        <Text fontSize="$5" fontWeight="700">
          New app
        </Text>
        <Button size="$2" onPress={onCancel} disabled={busy}>
          Cancel
        </Button>
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
            <Button
              key={s}
              size="$2"
              bg={source === s ? '$color5' : 'transparent'}
              borderWidth={1}
              borderColor="$borderColor"
              onPress={() => setSource(s)}
              disabled={busy}
            >
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

      {state.phase === 'error' ? (
        <Text fontSize="$2" color="$red10">
          {state.message}
        </Text>
      ) : null}

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
        <Text fontSize="$5" fontWeight="700">
          {live ? 'Your app is live' : 'Deploying your app'}
        </Text>
        <PrimaryButton size="$2" onPress={onDone}>
          {live ? 'View apps' : 'Run in background'}
        </PrimaryButton>
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
