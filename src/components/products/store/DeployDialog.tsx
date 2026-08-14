'use client'

/**
 * Deploy dialog — one-click deploy of an OSS App Store app over the console's REAL deploy
 * path: `PaasApi` → the cloud binary's `/v1/platform/*` container-app subsystem (the SAME
 * projects → apps → deployments surface the Compute › Applications board drives). We do NOT
 * rebuild the deploy backend; we drive it.
 *
 * Flow: ensure a target project (a fresh auto-named one, or an existing one the user picks)
 * → create an app from the app's open-source repository (`source: 'git'`, Hanzo Cloud builds
 * it with BuildKit) → kick off a deploy → show the honest build/live status with a link into
 * the project's deploy hub. Every phase is real; a failure surfaces the backend's own message
 * (never a fabricated success). An app with no buildable repo never reaches this dialog.
 */
import { useCallback, useEffect, useState } from 'react'
import { useRouter } from '~/lib/router'
import { Button, Card, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { ArrowUpRight, Check, Github, Rocket } from '@hanzogui/lucide-icons-2'

import { config } from '~/config'
import { type OssApp } from '~/lib/api/oss-apps'
import { PaasApi, type PaasDeployment } from '~/lib/api/paas'
import { SlideOver } from '~/components/ui/SlideOver'
import { asApiError } from '~/components/ui/States'
import { slugify } from './logic'
import { FieldRow, FieldSelect, PrimaryButton, StatusTag } from '@hanzo/ui/product'

/** A short, collision-resistant suffix so the project/app slug is always unique. */
const shortId = () => Math.random().toString(36).slice(2, 8)

type Phase =
  | { t: 'idle' }
  | { t: 'working'; step: string }
  | { t: 'done'; projectSlug: string; appSlug: string; dep: PaasDeployment }
  | { t: 'error'; message: string }

export function DeployDialog({ app, onClose }: { app: OssApp | null; onClose: () => void }) {
  const router = useRouter()
  const [projects, setProjects] = useState<string[]>([])
  const [target, setTarget] = useState('') // '' → a new auto-named project
  const [phase, setPhase] = useState<Phase>({ t: 'idle' })

  // Reset + best-effort load of the org's existing projects each time a card opens.
  useEffect(() => {
    if (!app) return
    setPhase({ t: 'idle' })
    setTarget('')
    let live = true
    PaasApi.listProjects()
      .then((ps) => {
        if (live) setProjects(ps.map((p) => p.slug || p.id).filter(Boolean))
      })
      .catch(() => {
        if (live) setProjects([])
      })
    return () => {
      live = false
    }
  }, [app])

  const run = useCallback(async () => {
    if (!app) return
    const github = app.links.github
    if (!github) {
      setPhase({ t: 'error', message: 'This app has no buildable repository to deploy from.' })
      return
    }
    try {
      setPhase({ t: 'working', step: target ? 'Preparing project…' : 'Creating project…' })
      let projectSlug = target
      if (!projectSlug) {
        const slug = `${slugify(app.id)}-${shortId()}`
        const project = await PaasApi.createProject({
          name: app.name,
          slug,
          description: `${app.name} — deployed from the App Store`,
        })
        projectSlug = project.slug || slug
      }
      setPhase({ t: 'working', step: `Creating ${app.name}…` })
      const appSlug = `${slugify(app.id)}-${shortId()}`
      await PaasApi.createApp(projectSlug, {
        name: app.name,
        slug: appSlug,
        description: app.description,
        source: 'git',
        repo: { url: github },
      })
      setPhase({ t: 'working', step: 'Starting deploy…' })
      const dep = await PaasApi.deploy(projectSlug, appSlug)
      setPhase({ t: 'done', projectSlug, appSlug, dep })
    } catch (e) {
      setPhase({ t: 'error', message: asApiError(e).message || 'Deploy failed.' })
    }
  }, [app, target])

  const working = phase.t === 'working'

  return (
    <SlideOver open={!!app} onClose={onClose} title={app ? `Deploy ${app.name}` : 'Deploy'} icon={Rocket} size={480}>
      {app ? (
        <YStack gap="$3">
          {/* What this deploys — honest about the source + the build. */}
          <Card bg="$color2" borderWidth={1} borderColor="$borderColor" p="$3" gap="$1.5">
            <XStack gap="$2" items="center">
              <Github size={15} color="$color11" />
              <Text fontSize="$2" color="$color12" numberOfLines={1}>
                {app.links.github?.replace(/^https?:\/\/(www\.)?github\.com\//, '')}
              </Text>
            </XStack>
            <Text fontSize="$1" color="$color10">
              {config.brandName} builds {app.name} from its open-source repository (BuildKit) and runs it as a
              container app in your org. Multi-service apps may need environment configuration after the first deploy.
            </Text>
          </Card>

          <FieldRow label="Project">
            <FieldSelect
              value={target}
              options={projects}
              onChange={setTarget}
              disabled={working}
              placeholder={projects.length ? 'New project (auto-named)' : 'New project (auto-named) — no existing projects'}
            />
            <Text fontSize="$1" color="$color9" mt="$1">
              {target ? `Deploys into your “${target}” project.` : 'Creates a new project named after the app.'}
            </Text>
          </FieldRow>

          {phase.t === 'done' ? (
            <Card bg="$color2" borderWidth={1} borderColor="$borderColor" p="$3" gap="$2">
              <XStack gap="$2" items="center">
                <Check size={16} color="$green10" />
                <Text fontSize="$3" fontWeight="700" color="$color12">
                  Deploy started
                </Text>
                <StatusTag status={phase.dep.status || 'building'} />
              </XStack>
              <Text fontSize="$2" color="$color11">
                {app.name} is building on {config.brandName}. Track its build, logs, and live URL in the project’s deploy hub.
              </Text>
              <XStack gap="$2" flexWrap="wrap">
                <PrimaryButton
                  size="$2"
                  icon={<ArrowUpRight size={14} />}
                  onPress={() => {
                    onClose()
                    router.push(`/platform/${phase.projectSlug}`)
                  }}
                >
                  Open project
                </PrimaryButton>
                <Button size="$2" chromeless onPress={onClose}>
                  Close
                </Button>
              </XStack>
            </Card>
          ) : phase.t === 'error' ? (
            <Card bg="$red2" borderColor="$red6" borderWidth={1} p="$3" gap="$2">
              <Text fontSize="$2" color="$red11">
                {phase.message}
              </Text>
              <XStack gap="$2">
                <PrimaryButton size="$2" icon={<Rocket size={14} />} onPress={() => void run()}>
                  Try again
                </PrimaryButton>
                <Button size="$2" chromeless onPress={onClose}>
                  Cancel
                </Button>
              </XStack>
            </Card>
          ) : (
            <XStack gap="$2" items="center" flexWrap="wrap">
              <PrimaryButton icon={working ? <Spinner size="small" /> : <Rocket size={15} />} onPress={() => void run()} disabled={working}>
                {working ? (phase as { step: string }).step : 'Deploy'}
              </PrimaryButton>
              {!working ? (
                <Button chromeless onPress={onClose}>
                  Cancel
                </Button>
              ) : null}
            </XStack>
          )}
        </YStack>
      ) : null}
    </SlideOver>
  )
}
