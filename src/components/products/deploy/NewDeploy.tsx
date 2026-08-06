'use client'

/**
 * New deployment — pick a repo, a host, and env, then ship.
 *
 * Two destinations behind one form, because "deploy this repo" is one intent:
 *  - APP  → `POST /v1/platform/projects/:project/apps` (201, `status: "draft"`)
 *           then `POST …/apps/:app/deploy` (202). Creating an app does NOT start
 *           it, so a form that stopped at 201 would report success over a thing
 *           that never ran. Both calls are made, and a failure names its step.
 *  - SITE → `POST /v1/platform/sites` (201). A static build is published by an
 *           upload or a git deploy afterwards, so this creates the target and the
 *           board shows it as `draft` until something is published to it.
 *
 * Env values are typed here and POSTed straight to cloud, which stores secrets in
 * KMS. They are never logged, never persisted by the browser, and never read back
 * into this form — cloud masks a secret's value on read, so re-submitting what a
 * read returned would blank the secret. That is why this form only CREATES env
 * and has no edit mode.
 */
import { useEffect, useMemo, useState } from 'react'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { Rocket } from '@hanzogui/lucide-icons-2'

import { PaasApi, type PaasProject } from '~/lib/api/paas'
import { PlatformSitesApi, SITE_FRAMEWORKS } from '~/lib/api/platform-sites'
import { FieldRow, FieldText, FieldTextArea, FieldOptionSelect } from '~/components/ui/Field'
import { PrimaryButton } from '~/components/ui/PrimaryButton'
import { formError, repoName, toAppInput, toSiteInput, type DeployForm } from '~/lib/deploy/board'
import { interpretPlatformError, PlatformStateCard, type PlatformError } from '../platform/state'

const EMPTY: DeployForm = { kind: 'app', name: '', repo: '', branch: '', host: '', env: '', framework: 'static' }

export function NewDeploy({ onCancel, onDeployed }: { onCancel: () => void; onDeployed: () => void }) {
  const [form, setForm] = useState<DeployForm>(EMPTY)
  const [projects, setProjects] = useState<PaasProject[]>([])
  const [project, setProject] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<PlatformError | null>(null)
  // Validation stays quiet until something has been typed — an untouched form is
  // incomplete, not wrong.
  const [touched, setTouched] = useState(false)

  // Any edit counts as touched: the reason a disabled Deploy button is disabled
  // must appear as soon as someone starts filling the form, not only once they
  // happen to touch the repo field.
  const set = (patch: Partial<DeployForm>) => {
    setTouched(true)
    setForm((f) => ({ ...f, ...patch }))
  }

  useEffect(() => {
    let live = true
    PaasApi.listProjects()
      .then((p) => {
        if (!live) return
        setProjects(p)
        setProject((cur) => cur || p[0]?.slug || '')
      })
      .catch(() => live && setProjects([]))
    return () => {
      live = false
    }
  }, [])

  const problem = useMemo(() => formError(form, project || null), [form, project])

  const submit = async () => {
    setTouched(true)
    if (problem) return
    setBusy(true)
    setFailure(null)
    try {
      if (form.kind === 'site') {
        await PlatformSitesApi.create(toSiteInput(form))
      } else {
        // `project` is non-empty here by `formError`; that is the contract between
        // the two, not an assumption about the fetch above.
        const app = await PaasApi.createApp(project, toAppInput(form))
        await PaasApi.deploy(project, app.slug)
      }
      onDeployed()
    } catch (e) {
      setFailure(interpretPlatformError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card borderWidth={1} borderColor="$borderColor" p="$4" gap="$3.5" data-testid="new-deploy">
      <XStack items="center" gap="$2">
        <Rocket size={16} color="$color10" />
        <Text fontSize="$5" fontWeight="600" color="$color12">
          New deployment
        </Text>
      </XStack>

      <FieldRow label="Type">
        <XStack gap="$2">
          {(['app', 'site'] as const).map((k) => (
            <Button
              key={k}
              size="$2"
              bg={form.kind === k ? '$color5' : 'transparent'}
              borderWidth={1}
              borderColor="$borderColor"
              aria-pressed={form.kind === k}
              onPress={() => set({ kind: k })}
            >
              {k === 'app' ? 'App' : 'Static site'}
            </Button>
          ))}
        </XStack>
      </FieldRow>

      {form.kind === 'app' ? (
        <FieldRow label="Project">
          <FieldOptionSelect
            value={project}
            options={projects.map((p) => ({ value: p.slug, label: p.name || p.slug }))}
            placeholder={projects.length ? 'Select a project' : 'No projects yet'}
            onChange={setProject}
          />
        </FieldRow>
      ) : null}

      <FieldRow label={form.kind === 'app' ? 'Repository' : 'Repository (optional)'}>
        <FieldText
          value={form.repo}
          placeholder="https://git.hanzo.ai/hanzoai/console.git"
          onChange={(v) => {
            // The name follows the repo until it is edited by hand; once the two
            // differ, typing a URL stops overwriting a deliberate name.
            const derived = repoName(form.repo)
            set({ repo: v, ...(form.name === '' || form.name === derived ? { name: repoName(v) } : {}) })
          }}
        />
      </FieldRow>

      <FieldRow label="Name">
        <FieldText value={form.name} placeholder="console" onChange={(v) => set({ name: v })} />
      </FieldRow>

      <FieldRow label="Branch">
        <FieldText value={form.branch ?? ''} placeholder="main" onChange={(v) => set({ branch: v })} />
      </FieldRow>

      {form.kind === 'site' ? (
        <FieldRow label="Framework">
          <FieldOptionSelect
            value={form.framework ?? 'static'}
            options={SITE_FRAMEWORKS.map((f) => ({ value: f, label: f }))}
            onChange={(v) => set({ framework: v })}
          />
        </FieldRow>
      ) : (
        <>
          <FieldRow label="Custom host">
            <YStack gap="$1.5">
              <FieldText
                value={form.host ?? ''}
                placeholder="app.example.com"
                onChange={(v) => set({ host: v })}
              />
              <Text fontSize="$1" color="$color10">
                Optional — every app is born with a host on hanzo.app. A custom host stays pending until you
                prove ownership with the DNS record shown under Domains.
              </Text>
            </YStack>
          </FieldRow>

          <FieldRow label="Environment">
            <YStack gap="$1.5">
              <FieldTextArea value={form.env ?? ''} rows={4} onChange={(v) => set({ env: v })} />
              <Text fontSize="$1" color="$color10">
                One KEY=VALUE per line. Anything naming a credential is stored as a secret in KMS and masked
                afterwards — this form can set a secret, never read one back.
              </Text>
            </YStack>
          </FieldRow>
        </>
      )}

      {failure ? <PlatformStateCard error={failure} /> : null}

      <XStack gap="$2" items="center" flexWrap="wrap">
        <PrimaryButton disabled={busy || !!problem} onPress={() => void submit()}>
          {busy ? 'Deploying…' : 'Deploy'}
        </PrimaryButton>
        <Button disabled={busy} onPress={onCancel}>
          Cancel
        </Button>
        {touched && problem ? (
          <Text fontSize="$2" color="$color11" role="alert">
            {problem}
          </Text>
        ) : null}
      </XStack>
    </Card>
  )
}
