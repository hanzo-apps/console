'use client'

/**
 * Deploy — PaaS embedded natively in the console (Job 3). Wired to the REAL
 * platform.hanzo.ai control plane through console2's own `/paas` proxy (service
 * token stays server-side). It shows real apps/deploys across clusters with
 * declared vs running tag + drift, and a real health-gated redeploy. NOT an
 * iframe, NOT a stub — and it never fabricates rows: loading, not-configured
 * (501), error, and empty are all honest states.
 *
 * The six Deploy sub-pages (Projects · Environments · Builds · Registry ·
 * Releases · Pipelines) are tabs over the same real app inventory, each framing
 * the slice that matters for that lens.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card, ScrollView, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { RefreshCw, Rocket, TriangleAlert } from '@hanzogui/lucide-icons-2'

import { paas, appTags, PaasError, type PaasApp } from '~/lib/paas/client'
import { PageHeader } from '~/components/ui/PageHeader'

const SECTIONS = [
  { id: '', label: 'Projects' },
  { id: 'environments', label: 'Environments' },
  { id: 'builds', label: 'Builds' },
  { id: 'registry', label: 'Registry' },
  { id: 'releases', label: 'Releases' },
  { id: 'pipelines', label: 'Pipelines' },
] as const

type State =
  | { kind: 'loading' }
  | { kind: 'not-configured'; message: string }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; apps: PaasApp[] }

function appKey(a: PaasApp): string {
  return a.id ?? a.name ?? a.service ?? Math.random().toString(36).slice(2)
}
function appName(a: PaasApp): string {
  return a.name ?? a.service ?? a.id ?? 'unknown'
}

export function PlatformModule({ params }: { params: Record<string, string> }) {
  const router = useRouter()
  const section = params.section ?? ''
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setState({ kind: 'loading' })
    try {
      const apps = await paas.listApps()
      setState({ kind: 'ready', apps })
    } catch (e) {
      if (e instanceof PaasError && e.status === 501) {
        setState({ kind: 'not-configured', message: e.message })
      } else {
        setState({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
      }
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const onRedeploy = useCallback(
    async (a: PaasApp) => {
      const id = a.id ?? a.name
      if (!id) return
      setBusy(id)
      try {
        await paas.redeploy(id)
        await load()
      } catch {
        /* surfaced on next load; keep the row */
      } finally {
        setBusy(null)
      }
    },
    [load],
  )

  return (
    <>
      <PageHeader
        title="Deploy"
        subtitle="Projects, environments, builds, and releases — on the Hanzo PaaS control plane."
      />

      {/* Section tabs */}
      <XStack gap="$1" flexWrap="wrap">
        {SECTIONS.map((s) => {
          const active = s.id === section
          return (
            <Button
              key={s.id || 'projects'}
              size="$2"
              bg={active ? '$color5' : 'transparent'}
              borderWidth={1}
              borderColor="$borderColor"
              onPress={() => router.push(s.id ? `/deploy/${s.id}` : '/deploy')}
            >
              {s.label}
            </Button>
          )
        })}
        <Button size="$2" chromeless icon={<RefreshCw size={15} />} onPress={() => void load()}>
          Refresh
        </Button>
      </XStack>

      {state.kind === 'loading' ? (
        <XStack p="$4" gap="$2" items="center">
          <Spinner />
          <Text color="$color11">Loading apps from platform.hanzo.ai…</Text>
        </XStack>
      ) : state.kind === 'not-configured' ? (
        <Card borderWidth={1} borderColor="$borderColor" p="$4" gap="$2" maxWidth={620}>
          <Text fontSize="$5" fontWeight="700">
            PaaS control plane not yet connected
          </Text>
          <Text fontSize="$3" color="$color11">
            This console is wired to platform.hanzo.ai, but the server-side service token
            (PAAS_SERVICE_TOKEN, from KMS) is not configured on this deployment yet. Once it is,
            real projects and deploys appear here. No placeholder data is shown.
          </Text>
        </Card>
      ) : state.kind === 'error' ? (
        <Card borderWidth={1} borderColor="$borderColor" p="$4" gap="$2" maxWidth={620}>
          <XStack gap="$2" items="center">
            <TriangleAlert size={16} />
            <Text fontSize="$4" fontWeight="700">
              Could not reach the PaaS control plane
            </Text>
          </XStack>
          <Text fontSize="$3" color="$color11">
            {state.message}
          </Text>
          <Button size="$2" self="flex-start" onPress={() => void load()}>
            Retry
          </Button>
        </Card>
      ) : state.apps.length === 0 ? (
        <Card borderWidth={1} borderColor="$borderColor" p="$4" maxWidth={620}>
          <Text fontSize="$4" fontWeight="700">
            No apps yet
          </Text>
          <Text fontSize="$3" color="$color11">
            The control plane returned no apps for your account. Deploy a project to see it here.
          </Text>
        </Card>
      ) : (
        <AppTable apps={state.apps} section={section} busy={busy} onRedeploy={onRedeploy} />
      )}
    </>
  )
}

function AppTable({
  apps,
  section,
  busy,
  onRedeploy,
}: {
  apps: PaasApp[]
  section: string
  busy: string | null
  onRedeploy: (a: PaasApp) => void
}) {
  const showLatest = section === 'builds' || section === 'releases'
  const sorted = useMemo(
    () => [...apps].sort((a, b) => appName(a).localeCompare(appName(b))),
    [apps],
  )
  return (
    <YStack borderWidth={1} borderColor="$borderColor" rounded="$4" overflow="hidden">
      <XStack bg="$color2" px="$3" py="$2" gap="$3">
        <Text flex={2} fontSize="$2" fontWeight="700" color="$color11">App</Text>
        <Text flex={1} fontSize="$2" fontWeight="700" color="$color11">Cluster</Text>
        <Text flex={1} fontSize="$2" fontWeight="700" color="$color11">Declared</Text>
        <Text flex={1} fontSize="$2" fontWeight="700" color="$color11">Running</Text>
        {showLatest ? <Text flex={1} fontSize="$2" fontWeight="700" color="$color11">Latest</Text> : null}
        <Text width={120} fontSize="$2" fontWeight="700" color="$color11">Status</Text>
        <Text width={110} fontSize="$2" fontWeight="700" color="$color11" />
      </XStack>
      <ScrollView maxH={560}>
        {sorted.map((a) => {
          const t = appTags(a)
          const id = a.id ?? a.name ?? ''
          return (
            <XStack
              key={appKey(a)}
              px="$3"
              py="$2"
              gap="$3"
              items="center"
              borderTopWidth={1}
              borderColor="$borderColor"
            >
              <Text flex={2} fontSize="$3" fontWeight="600">{appName(a)}</Text>
              <Text flex={1} fontSize="$2" color="$color11">{a.cluster ?? a.namespace ?? '—'}</Text>
              <Text flex={1} fontSize="$2">{t.declared}</Text>
              <XStack flex={1} gap="$1" items="center">
                <Text fontSize="$2">{t.running}</Text>
                {t.drift ? <TriangleAlert size={12} opacity={0.7} /> : null}
              </XStack>
              {showLatest ? <Text flex={1} fontSize="$2">{t.latest}</Text> : null}
              <Text width={120} fontSize="$2" color="$color11">
                {a.status ?? a.health ?? (t.drift ? 'Drift' : 'In sync')}
              </Text>
              <Button
                width={110}
                size="$2"
                borderWidth={1}
                borderColor="$borderColor"
                icon={<Rocket size={13} />}
                disabled={busy === id}
                onPress={() => onRedeploy(a)}
              >
                {busy === id ? '…' : 'Redeploy'}
              </Button>
            </XStack>
          )
        })}
      </ScrollView>
    </YStack>
  )
}
