'use client'

/**
 * Deploy hub — the console's "Let's build something new" surface, the uniform way
 * to deploy ANY new project/service/container/site. Mirrors the hanzo.app/new hub
 * (hero + composer + connect-git + templates) but native @hanzo/gui + true-black
 * dark, and infra-first: it LEADS with repo→deploy against the REAL per-org Hanzo
 * PaaS (`/v1/platform/*` via the `/cloud` bearer proxy), watching the deploy go
 * Queued → Building → Deploying → Live on the live RailwayDeploy pipeline.
 *
 * Three real, uniform targets (each a shape `PaasApi.createApp` accepts — no
 * invented targets): Service (git → build → run), Static site (git → static),
 * Container (prebuilt image → run). The connect-git dropdown is REAL — it lists the
 * signed-in user's GitHub repos via the same connected-git BFF (console-served at `/git`)
 * contract hanzo.app serves (resolved from the IAM-linked token server-side), and
 * degrades to an honest "Connect GitHub" CTA when GitHub isn't linked. The
 * "describe an app" path links out to Hanzo Build (hanzo.app), which owns the AI
 * app-builder. Templates are the real gallery (`/v1/templates`).
 *
 * Every state is honest — never a fabricated project/repo/template row.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card, Input, ScrollView, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import {
  ArrowRight,
  ArrowUpRight,
  ExternalLink,
  Github,
  Globe,
  LayoutTemplate,
  Lock,
  Package,
  RefreshCw,
  Rocket,
  Search,
  Server,
  Sparkles,
  X,
} from '@hanzogui/lucide-icons-2'

import { config } from '~/config'
import { PaasApi, type PaasProject } from '~/lib/api/paas'
import { fetchGitAccounts, fetchGitRepos, relativeTime, type GitAccount, type GitRepo } from '~/lib/api/git'
import { TemplatesApi, buildBuilderUrl, type Template } from '~/lib/api/templates'
import { classifyBackend, type BackendState } from '~/components/ui/BackendState'
import { PrimaryButton } from '~/components/ui/PrimaryButton'
import { FieldSelect } from '~/components/ui/Field'
import { RailwayDeploy } from '../paas/RailwayDeploy'
import { launchDeploy, type LaunchStep } from '../paas/deploy'
import {
  classifyPaasError,
  deriveAppName,
  looksLikeGitUrl,
  looksLikeImageRef,
  targetIsGit,
  type DeployTarget,
} from '../paas/logic'

const NEW_PROJECT = '➕ New project…'

const openExternal = (href: string) => {
  if (typeof window !== 'undefined') window.open(href, '_blank', 'noopener,noreferrer')
}

/** The Hanzo Build (hanzo.app) deep-link that builds an app from a description. */
function aiBuildHref(text: string): string {
  const base = config.appUrl.replace(/\/+$/, '')
  const t = text.trim()
  if (!t) return `${base}/new`
  const url = new URL(`${base}/dev`)
  url.searchParams.set('prompt', t)
  return url.toString()
}

const TARGETS: { id: DeployTarget; label: string; icon: typeof Server; blurb: string }[] = [
  { id: 'service', label: 'Service', icon: Server, blurb: 'Build a Git repo and run it as a container service.' },
  { id: 'static', label: 'Static site', icon: Globe, blurb: 'Build a Git repo and serve it as a static site.' },
  { id: 'container', label: 'Container', icon: Package, blurb: 'Run a prebuilt container image as-is.' },
]

export function DeployHub(_props: { params: Record<string, string> }) {
  const router = useRouter()

  // Composer state (lifted so the connect-git dropdown can fill it) ─────────────
  const [target, setTarget] = useState<DeployTarget>('service')
  const [ref, setRef] = useState('')
  const [branch, setBranch] = useState('main')
  const [appName, setAppName] = useState('')
  const [appNameTouched, setAppNameTouched] = useState(false)

  const [projects, setProjects] = useState<PaasProject[]>([])
  const [projectChoice, setProjectChoice] = useState<string>(NEW_PROJECT)
  const [newProjectName, setNewProjectName] = useState('')

  const [phase, setPhase] = useState<'idle' | 'working' | 'error' | 'watching'>('idle')
  const [step, setStep] = useState<LaunchStep>('project')
  const [errMsg, setErrMsg] = useState('')
  const [watch, setWatch] = useState<{ project: string; app: string } | null>(null)

  const composerRef = useRef<HTMLDivElement | null>(null)

  const loadProjects = useCallback(() => {
    PaasApi.listProjects()
      .then((ps) => {
        setProjects(ps)
        setProjectChoice((prev) => (prev === NEW_PROJECT && ps.length > 0 ? (ps[0].name || ps[0].slug) : prev))
      })
      .catch(() => setProjects([]))
  }, [])

  useEffect(() => {
    loadProjects()
  }, [loadProjects])

  // Set the deploy source; auto-derive the app name until the user edits it.
  const setSource = useCallback(
    (v: string) => {
      setRef(v)
      if (!appNameTouched) {
        const d = deriveAppName(v)
        if (d) setAppName(d)
      }
    },
    [appNameTouched],
  )

  // Select a repo from the connect-git dropdown → fill the composer for a service.
  const pickRepo = useCallback((repo: GitRepo) => {
    setTarget('service')
    setRef(repo.cloneUrl)
    setBranch(repo.defaultBranch || 'main')
    setAppName(deriveAppName(repo.name) || repo.name)
    setAppNameTouched(false)
    setPhase('idle')
    setErrMsg('')
    if (typeof window !== 'undefined' && composerRef.current) {
      composerRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [])

  const creatingProject = projectChoice === NEW_PROJECT || projects.length === 0
  const projectOptions = useMemo(() => [...projects.map((p) => p.name || p.slug), NEW_PROJECT], [projects])

  const isGit = targetIsGit(target)
  const refLooksRight = ref.trim() === '' || (isGit ? looksLikeGitUrl(ref) : looksLikeImageRef(ref))
  // Only a description (NL) — not a URL and not an image ref — offers the AI path.
  const looksLikeDescription = ref.trim() !== '' && !looksLikeGitUrl(ref) && !looksLikeImageRef(ref)

  const valid =
    appName.trim() !== '' &&
    ref.trim() !== '' &&
    (creatingProject ? newProjectName.trim() !== '' : projectChoice !== '')

  const deploy = () => {
    if (!valid || phase === 'working') return
    setPhase('working')
    setErrMsg('')
    const chosen = projects.find((p) => (p.name || p.slug) === projectChoice)
    launchDeploy(
      {
        projectSlug: creatingProject ? undefined : chosen?.slug || chosen?.id || projectChoice,
        newProjectName: creatingProject ? newProjectName.trim() : undefined,
        appName: appName.trim(),
        target,
        ref: ref.trim(),
        branch: branch.trim() || 'main',
      },
      setStep,
    )
      .then(({ project, app }) => {
        setWatch({ project, app })
        setPhase('watching')
      })
      .catch((e) => {
        const { kind, message } = classifyPaasError(e)
        setPhase('error')
        setErrMsg(
          kind === 'signin'
            ? 'Sign in to deploy.'
            : kind === 'forbidden'
              ? 'Deploying requires platform access for your organization.'
              : message || 'Deploy failed. Check the inputs and retry.',
        )
      })
  }

  const resetComposer = () => {
    setPhase('idle')
    setWatch(null)
    setRef('')
    setAppName('')
    setAppNameTouched(false)
    setErrMsg('')
    loadProjects()
  }

  const busy = phase === 'working'
  const stepLabel = step === 'project' ? 'Preparing project…' : step === 'app' ? 'Creating app…' : 'Deploying…'

  return (
    <YStack gap="$5">
      <Hero />

      {/* Primary composer */}
      <div ref={composerRef}>
        {phase === 'watching' && watch ? (
          <DeployWatchCard
            project={watch.project}
            app={watch.app}
            onView={() => router.push('/applications')}
            onAnother={resetComposer}
          />
        ) : (
          <Card
            className="hz-lift"
            p="$4"
            gap="$3.5"
            borderWidth={1}
            borderColor="$borderColor"
            bg="$color1"
            rounded="$6"
            hoverStyle={{ borderColor: '$color7' }}
          >
            <TargetSelector target={target} onChange={setTarget} disabled={busy} />

            {/* The source input — a Git repo URL (service/static) or an image ref. */}
            <YStack gap="$2">
              <XStack
                items="center"
                gap="$2"
                px="$3"
                bg="$color2"
                borderWidth={1}
                borderColor={ref.trim() && !refLooksRight ? '$yellow7' : '$borderColor'}
                rounded="$4"
              >
                {isGit ? <Github size={17} color="$color10" /> : <Package size={17} color="$color10" />}
                <Input
                  unstyled
                  flex={1}
                  py="$3"
                  fontSize="$4"
                  color="$color12"
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder={isGit ? 'https://github.com/org/repo' : 'ghcr.io/org/app:tag'}
                  value={ref}
                  onChangeText={setSource}
                  disabled={busy}
                />
                {ref ? (
                  <Button chromeless circular size="$1" icon={<X size={14} />} onPress={() => setSource('')} aria-label="Clear" disabled={busy} />
                ) : null}
              </XStack>

              {looksLikeDescription ? (
                <XStack items="center" gap="$2" flexWrap="wrap">
                  <Sparkles size={14} color="$color10" />
                  <Text fontSize="$2" color="$color10">
                    That looks like a description, not a repo.
                  </Text>
                  <Button size="$1" chromeless iconAfter={<ExternalLink size={12} />} onPress={() => openExternal(aiBuildHref(ref))}>
                    <Text fontSize="$2" color="$color12" fontWeight="700">Build it with AI</Text>
                  </Button>
                </XStack>
              ) : (
                <Text fontSize="$1" color="$color10">
                  {TARGETS.find((t) => t.id === target)?.blurb}
                </Text>
              )}
            </YStack>

            {/* App name + branch (git) */}
            <XStack gap="$3" flexWrap="wrap">
              <YStack flex={1} minW={200} gap="$1.5">
                <Text fontSize="$2" color="$color11" fontWeight="600">App name</Text>
                <Input
                  size="$3"
                  value={appName}
                  onChangeText={(v) => { setAppName(v); setAppNameTouched(true) }}
                  placeholder="web"
                  autoCapitalize="none"
                  disabled={busy}
                />
              </YStack>
              {isGit ? (
                <YStack width={180} minW={140} gap="$1.5">
                  <Text fontSize="$2" color="$color11" fontWeight="600">Branch</Text>
                  <Input size="$3" value={branch} onChangeText={setBranch} placeholder="main" autoCapitalize="none" disabled={busy} />
                </YStack>
              ) : null}
            </XStack>

            {/* Project */}
            <XStack gap="$3" flexWrap="wrap">
              <YStack flex={1} minW={200} gap="$1.5">
                <Text fontSize="$2" color="$color11" fontWeight="600">Project</Text>
                {projects.length > 0 ? (
                  <FieldSelect value={projectChoice} options={projectOptions} onChange={setProjectChoice} disabled={busy} />
                ) : (
                  <Input size="$3" value={newProjectName} onChangeText={setNewProjectName} placeholder="my-project" autoCapitalize="none" disabled={busy} />
                )}
              </YStack>
              {creatingProject && projects.length > 0 ? (
                <YStack flex={1} minW={200} gap="$1.5">
                  <Text fontSize="$2" color="$color11" fontWeight="600">New project name</Text>
                  <Input size="$3" value={newProjectName} onChangeText={setNewProjectName} placeholder="my-project" autoCapitalize="none" disabled={busy} />
                </YStack>
              ) : null}
            </XStack>

            {phase === 'error' ? <Text fontSize="$2" color="$red10">{errMsg}</Text> : null}

            <XStack items="center" gap="$3" flexWrap="wrap">
              <PrimaryButton
                size="$4"
                icon={busy ? <Spinner size="small" /> : <Rocket size={17} />}
                onPress={deploy}
                disabled={!valid || busy}
              >
                {busy ? stepLabel : 'Deploy'}
              </PrimaryButton>
              <Text fontSize="$1" color="$color10">
                {target === 'container'
                  ? 'Applies the image and goes live.'
                  : 'Builds from source in-cluster (BuildKit), then goes live.'}
              </Text>
            </XStack>
          </Card>
        )}
      </div>

      {/* Two-column: connect a repo · start from a template */}
      <XStack gap="$4" flexWrap="wrap" items="flex-start">
        <YStack flex={1} minW={300}>
          <GitConnect onPick={pickRepo} />
        </YStack>
        <YStack flex={1} minW={300}>
          <TemplatePicker onBrowseAll={() => router.push('/templates')} />
        </YStack>
      </XStack>
    </YStack>
  )
}

// ── Hero ─────────────────────────────────────────────────────────────────────

function Hero() {
  return (
    <YStack position="relative" items="center" pt="$4" pb="$2" gap="$3">
      {/* Ambient radial glow behind the hero (decorative, non-interactive). */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          top: -40,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 720,
          maxWidth: '100%',
          height: 260,
          pointerEvents: 'none',
          background: 'radial-gradient(60% 60% at 50% 0%, rgba(255,255,255,0.07), transparent 70%)',
        }}
      />
      <YStack items="center" gap="$3" maxW={720} className="hz-fade-up">
        <XStack items="center" gap="$2" px="$3" py="$1.5" rounded="$10" borderWidth={1} borderColor="$borderColor" bg="$color2">
          <Rocket size={13} color="$color11" />
          <Text fontSize="$2" color="$color11" fontWeight="700">Deploy</Text>
        </XStack>
        <Text fontSize={36} lineHeight={42} fontWeight="800" text="center" letterSpacing={-0.5} $md={{ fontSize: 50, lineHeight: 56 }}>
          Let&rsquo;s build something new
        </Text>
        <Text fontSize="$4" color="$color11" text="center" maxW={560}>
          Paste a Git repository to deploy it as a service, container, or static site — or start from a template.
          Hanzo builds it in-cluster, ships it, and runs it, per organization.
        </Text>
      </YStack>
    </YStack>
  )
}

// ── Target selector ──────────────────────────────────────────────────────────

function TargetSelector({ target, onChange, disabled }: { target: DeployTarget; onChange: (t: DeployTarget) => void; disabled?: boolean }) {
  return (
    <XStack gap="$2" flexWrap="wrap">
      {TARGETS.map((t) => {
        const active = t.id === target
        const Icon = t.icon
        return (
          <Button
            key={t.id}
            size="$3"
            onPress={() => onChange(t.id)}
            disabled={disabled}
            bg={active ? '$color5' : 'transparent'}
            borderWidth={1}
            borderColor={active ? '$color8' : '$borderColor'}
            icon={<Icon size={15} />}
            hoverStyle={{ borderColor: '$color8' }}
            aria-label={t.label}
          >
            {t.label}
          </Button>
        )
      })}
    </XStack>
  )
}

// ── Deploy watch (the live pipeline hand-off) ────────────────────────────────

function DeployWatchCard({ project, app, onView, onAnother }: { project: string; app: string; onView: () => void; onAnother: () => void }) {
  const [live, setLive] = useState(false)
  return (
    <Card p="$4" gap="$3.5" borderWidth={1} borderColor="$borderColor" bg="$color1" rounded="$6">
      <XStack items="center" justify="space-between" gap="$3" flexWrap="wrap">
        <Text fontSize="$6" fontWeight="800">{live ? 'Your app is live' : 'Deploying your app'}</Text>
        <XStack gap="$2">
          <Button size="$3" onPress={onAnother}>Deploy another</Button>
          <PrimaryButton size="$3" onPress={onView}>{live ? 'View app' : 'View apps'}</PrimaryButton>
        </XStack>
      </XStack>
      <RailwayDeploy projectSlug={project} appSlug={app} status="queued" onLive={() => setLive(true)} />
      <Text fontSize="$1" color="$color10">
        {live
          ? 'It appears in Applications with its status, source, and live URL.'
          : 'This tracks the live deployment status — Queued → Building → Deploying → Live.'}
      </Text>
    </Card>
  )
}

// ── Connect a Git repository (real /git/* BFF) ────────────────────────────

type GitState =
  | { phase: 'loading' }
  | { phase: 'disconnected' }
  | { phase: 'error' }
  | { phase: 'ready'; accounts: GitAccount[] }

function GitConnect({ onPick }: { onPick: (repo: GitRepo) => void }) {
  const [state, setState] = useState<GitState>({ phase: 'loading' })
  const [account, setAccount] = useState('')
  const [q, setQ] = useState('')
  const [repos, setRepos] = useState<GitRepo[] | null>(null)
  const [loadingRepos, setLoadingRepos] = useState(false)

  const loadAccounts = useCallback(() => {
    setState({ phase: 'loading' })
    fetchGitAccounts()
      .then((r) => {
        if (!r.connected || r.accounts.length === 0) {
          setState({ phase: 'disconnected' })
          return
        }
        setState({ phase: 'ready', accounts: r.accounts })
        setAccount((prev) => prev || r.accounts[0].login)
      })
      .catch(() => setState({ phase: 'error' }))
  }, [])

  useEffect(() => {
    loadAccounts()
  }, [loadAccounts])

  // Load repos for the selected account (debounced on the search query).
  useEffect(() => {
    if (state.phase !== 'ready' || !account) return
    let cancelled = false
    setLoadingRepos(true)
    const h = setTimeout(() => {
      fetchGitRepos(account, q)
        .then((rs) => { if (!cancelled) setRepos(rs) })
        .finally(() => { if (!cancelled) setLoadingRepos(false) })
    }, q ? 250 : 0)
    return () => { cancelled = true; clearTimeout(h) }
  }, [state.phase, account, q])

  const accountLogins = state.phase === 'ready' ? state.accounts.map((a) => a.login) : []

  return (
    <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor" bg="$color1" rounded="$5" height="100%">
      <XStack items="center" justify="space-between" gap="$2">
        <XStack items="center" gap="$2" minW={0}>
          <Github size={16} />
          <Text fontSize="$4" fontWeight="700" numberOfLines={1}>Connect a Git repository</Text>
        </XStack>
        {state.phase === 'ready' ? (
          <Button size="$1" chromeless icon={<RefreshCw size={13} />} onPress={loadAccounts} aria-label="Refresh repositories" />
        ) : null}
      </XStack>

      {state.phase === 'loading' ? (
        <XStack items="center" gap="$2" py="$3"><Spinner size="small" /><Text fontSize="$2" color="$color10">Checking GitHub…</Text></XStack>
      ) : state.phase === 'disconnected' ? (
        <YStack gap="$3" py="$2">
          <Text fontSize="$2" color="$color11">
            Link your GitHub account to pick a repository and deploy it in one click. Your repos load here once connected.
          </Text>
          <Button
            size="$3"
            self="flex-start"
            icon={<Github size={15} />}
            iconAfter={<ExternalLink size={13} />}
            borderWidth={1}
            borderColor="$borderColor"
            hoverStyle={{ borderColor: '$color8' }}
            onPress={() => openExternal(`${config.iamUrl.replace(/\/+$/, '')}/account`)}
          >
            Connect GitHub
          </Button>
          <Text fontSize="$1" color="$color10">Or paste any repository URL in the composer above.</Text>
        </YStack>
      ) : state.phase === 'error' ? (
        <YStack gap="$2" py="$2">
          <Text fontSize="$2" color="$color11">Couldn&rsquo;t reach GitHub. Retry, or paste a repository URL above.</Text>
          <Button size="$2" self="flex-start" icon={<RefreshCw size={13} />} onPress={loadAccounts}>Retry</Button>
        </YStack>
      ) : (
        <YStack gap="$2.5">
          <XStack gap="$2" flexWrap="wrap">
            <YStack flex={1} minW={140}>
              <FieldSelect value={account} options={accountLogins} onChange={setAccount} />
            </YStack>
            <XStack flex={2} minW={160} items="center" gap="$2" px="$3" bg="$color2" borderWidth={1} borderColor="$borderColor" rounded="$4">
              <Search size={14} color="$color10" />
              <Input unstyled flex={1} py="$2" fontSize="$3" placeholder="Search repositories…" value={q} onChangeText={setQ} autoCapitalize="none" autoCorrect={false} />
              {q ? <Button chromeless circular size="$1" icon={<X size={12} />} onPress={() => setQ('')} aria-label="Clear" /> : null}
            </XStack>
          </XStack>

          {loadingRepos && repos === null ? (
            <XStack items="center" gap="$2" py="$3"><Spinner size="small" /><Text fontSize="$2" color="$color10">Loading repositories…</Text></XStack>
          ) : repos && repos.length > 0 ? (
            <ScrollView style={{ maxHeight: 320 }}>
              <YStack gap="$1.5">
                {repos.map((r) => (
                  <XStack
                    key={r.fullName}
                    className="hz-lift"
                    items="center"
                    gap="$2"
                    p="$2.5"
                    borderWidth={1}
                    borderColor="$borderColor"
                    rounded="$4"
                    cursor="pointer"
                    hoverStyle={{ borderColor: '$color8', bg: '$color2' }}
                    onPress={() => onPick(r)}
                    aria-label={`Deploy ${r.fullName}`}
                  >
                    <YStack minW={0} flex={1} gap="$0.5">
                      <XStack items="center" gap="$1.5" minW={0}>
                        <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>{r.name}</Text>
                        {r.private ? <Lock size={11} color="$color10" /> : null}
                      </XStack>
                      <Text fontSize="$1" color="$color10" numberOfLines={1}>
                        {r.fullName}{r.language ? ` · ${r.language}` : ''}{r.pushedAt ? ` · ${relativeTime(r.pushedAt)}` : ''}
                      </Text>
                    </YStack>
                    <ArrowRight size={15} color="$color10" />
                  </XStack>
                ))}
              </YStack>
            </ScrollView>
          ) : (
            <Text fontSize="$2" color="$color10" py="$2">{q ? `No repositories match “${q}”.` : 'No repositories found for this account.'}</Text>
          )}
        </YStack>
      )}
    </Card>
  )
}

// ── Start from a template (real /v1/templates gallery) ───────────────────────

type TplState =
  | { phase: 'loading' }
  | { phase: 'error'; error: BackendState }
  | { phase: 'ready'; templates: Template[] }

function TemplatePicker({ onBrowseAll }: { onBrowseAll: () => void }) {
  const [state, setState] = useState<TplState>({ phase: 'loading' })
  const [q, setQ] = useState('')

  const load = useCallback(() => {
    setState({ phase: 'loading' })
    TemplatesApi.list()
      .then((templates) => setState({ phase: 'ready', templates }))
      .catch((e) => setState({ phase: 'error', error: classifyBackend(e) }))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const all = state.phase === 'ready' ? state.templates : []
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return all
    return all.filter(
      (t) =>
        t.title.toLowerCase().includes(needle) ||
        (t.description ?? '').toLowerCase().includes(needle) ||
        (t.framework ?? '').toLowerCase().includes(needle) ||
        t.category.toLowerCase().includes(needle),
    )
  }, [all, q])

  return (
    <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor" bg="$color1" rounded="$5" height="100%">
      <XStack items="center" justify="space-between" gap="$2">
        <XStack items="center" gap="$2" minW={0}>
          <LayoutTemplate size={16} />
          <Text fontSize="$4" fontWeight="700" numberOfLines={1}>Start from a template</Text>
        </XStack>
        <Button size="$1" chromeless iconAfter={<ArrowUpRight size={13} />} onPress={onBrowseAll}>
          <Text fontSize="$2" color="$color11" fontWeight="700">Browse all</Text>
        </Button>
      </XStack>

      {state.phase === 'loading' ? (
        <XStack items="center" gap="$2" py="$3"><Spinner size="small" /><Text fontSize="$2" color="$color10">Loading templates…</Text></XStack>
      ) : state.phase === 'error' ? (
        <YStack gap="$2" py="$2" borderWidth={1} borderColor="$yellow7" bg="$yellow2" rounded="$4" p="$3">
          <Text fontSize="$2" color="$yellow11">The template gallery is unreachable right now.</Text>
          <Button size="$2" self="flex-start" icon={<RefreshCw size={13} />} onPress={load}>Retry</Button>
        </YStack>
      ) : all.length === 0 ? (
        <Text fontSize="$2" color="$color10" py="$2">No templates available yet.</Text>
      ) : (
        <YStack gap="$2.5">
          <XStack items="center" gap="$2" px="$3" bg="$color2" borderWidth={1} borderColor="$borderColor" rounded="$4">
            <Search size={14} color="$color10" />
            <Input unstyled flex={1} py="$2" fontSize="$3" placeholder="Search templates…" value={q} onChangeText={setQ} autoCapitalize="none" autoCorrect={false} />
            {q ? <Button chromeless circular size="$1" icon={<X size={12} />} onPress={() => setQ('')} aria-label="Clear" /> : null}
          </XStack>
          {filtered.length === 0 ? (
            <Text fontSize="$2" color="$color10" py="$2">No templates match “{q}”.</Text>
          ) : (
            <ScrollView style={{ maxHeight: 320 }}>
              <YStack gap="$1.5">
                {filtered.slice(0, 24).map((t) => (
                  <XStack
                    key={t.slug}
                    className="hz-lift"
                    items="center"
                    gap="$2"
                    p="$2.5"
                    borderWidth={1}
                    borderColor="$borderColor"
                    rounded="$4"
                    cursor="pointer"
                    hoverStyle={{ borderColor: '$color8', bg: '$color2' }}
                    onPress={() => openExternal(buildBuilderUrl(t, '', config.appUrl))}
                    aria-label={`Open ${t.title} in the builder`}
                  >
                    <YStack width={30} height={30} items="center" justify="center" rounded="$3" bg="$color3">
                      <LayoutTemplate size={15} color="$color11" />
                    </YStack>
                    <YStack minW={0} flex={1} gap="$0.5">
                      <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>{t.title}</Text>
                      <Text fontSize="$1" color="$color10" numberOfLines={1}>
                        {[t.framework, t.category].filter(Boolean).join(' · ') || t.category}
                      </Text>
                    </YStack>
                    <Sparkles size={14} color="$color10" />
                  </XStack>
                ))}
              </YStack>
            </ScrollView>
          )}
        </YStack>
      )}
    </Card>
  )
}
