'use client'

/**
 * Inference slide-over panes — endpoint detail + the real deploy flow — over the
 * shared `DetailPane` (mounted at the shell root), so opening either looks identical
 * to every other detail surface (DRY). Every value shown is REAL (from the endpoint's
 * live status + the usage ledger) or an honest "—"; the deploy form performs a REAL
 * `POST /v1/ml/models` and surfaces the backend's own result/error (never a fake OK).
 */
import { useState, type ReactNode } from 'react'
import { Button, Input, ScrollView, Text, XStack, YStack } from '@hanzo/gui'
import { BookOpen, Gauge, Rocket, Timer } from '@hanzogui/lucide-icons-2'

import { config } from '~/config'
import type { DetailPaneApi } from '~/components/DetailPane'
import { InferenceApi } from '~/lib/api/inference'
import { ApiError } from '~/lib/api'
import type { UsageRecord } from '~/lib/api/aimetrics'
import { LineChart } from '~/components/ui/Charts'
import { StatusTag } from '~/components/ui/StatusTag'
import { PrimaryButton } from '~/components/ui/PrimaryButton'
import { AccentButton, StatusDot } from './parts'
import {
  endpointDailyRequests,
  fmtCount,
  fmtUsd,
  logDetailFacts,
  perModelMap,
  type Endpoint,
  type LogLine,
} from './logic'
import { toneVar } from '~/components/ui/tone-var'

/** A label/value fact row. */
function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <XStack justify="space-between" items="center" gap="$3" py="$2" borderBottomWidth={1} borderColor="$borderColor">
      <Text fontSize="$2" color="$color10">
        {label}
      </Text>
      <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1}>
        {value}
      </Text>
    </XStack>
  )
}

/** A monospace code sample (honest: the REAL call form for this endpoint). */
function CodeBlock({ children }: { children: string }) {
  return (
    <YStack bg="$color1" borderWidth={1} borderColor="$borderColor" rounded="$4" p="$3">
      <Text fontSize="$2" color="$color11" style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
        {children}
      </Text>
    </YStack>
  )
}

/** The endpoint detail body — facts + a REAL 7-day request trend + honest "—" metrics. */
function EndpointDetailBody({ endpoint, records, hasLedger }: { endpoint: Endpoint; records: UsageRecord[]; hasLedger: boolean }) {
  const now = Date.now()
  const per24 = perModelMap(records, '24h', now)
  const req24 = hasLedger ? (per24.get(endpoint.name)?.requests ?? 0) : null
  const series = endpointDailyRequests(records, endpoint.name, '7d', now)
  const points = series.map((v, i) => ({ label: `${series.length - i}d`, value: v }))

  const call =
    endpoint.kind === 'deployed' && endpoint.url
      ? `curl ${endpoint.url}/v1/models/${endpoint.name}:predict \\\n  -H "Authorization: Bearer hk-..." \\\n  -d '{"instances": [ ... ]}'`
      : `curl https://api.${config.iamOrgName === 'hanzo' ? 'hanzo.ai' : `${config.iamOrgName}.cloud`}/v1/chat/completions \\\n  -H "Authorization: Bearer hk-..." \\\n  -d '{"model": "${endpoint.name}", "messages": [{"role":"user","content":"Hello"}]}'`

  return (
    <ScrollView>
      <YStack gap="$4" p="$1">
        <YStack>
          <Fact label="Type" value={endpoint.type} />
          <Fact label="Kind" value={endpoint.kind === 'deployed' ? 'Deployed (your InferenceService)' : 'Managed model endpoint'} />
          {endpoint.provider ? <Fact label="Provider" value={endpoint.provider} /> : null}
          <Fact label="Status" value={<StatusTag status={endpoint.phaseLabel} />} />
          <Fact label="Tier" value={endpoint.premium ? 'Premium' : 'Standard'} />
          {endpoint.createdAt ? <Fact label="Created" value={new Date(endpoint.createdAt).toLocaleDateString()} /> : null}
          {endpoint.url ? <Fact label="Serving URL" value={endpoint.url} /> : null}
        </YStack>

        <XStack gap="$3" flexWrap="wrap">
          <YStack flex={1} minW={120} gap="$1">
            <Text fontSize="$2" color="$color10">Requests (24h)</Text>
            <Text fontSize="$6" fontWeight="800" color="$color12">{fmtCount(req24)}</Text>
          </YStack>
          <YStack flex={1} minW={120} gap="$1">
            <XStack items="center" gap="$1.5"><Timer size={13} opacity={0.6} /><Text fontSize="$2" color="$color10">P95 latency</Text></XStack>
            <Text fontSize="$6" fontWeight="800" color="$color12">—</Text>
          </YStack>
          <YStack flex={1} minW={120} gap="$1">
            <XStack items="center" gap="$1.5"><Gauge size={13} opacity={0.6} /><Text fontSize="$2" color="$color10">Uptime (7d)</Text></XStack>
            <Text fontSize="$6" fontWeight="800" color="$color12">—</Text>
          </YStack>
        </XStack>

        <YStack gap="$2">
          <Text fontSize="$3" fontWeight="700" color="$color12">Requests over the last 7 days</Text>
          {points.length >= 2 ? (
            <LineChart data={points} formatValue={(v) => fmtCount(v)} height={140} />
          ) : (
            <Text fontSize="$2" color="$color10">
              {hasLedger ? 'Not enough recorded activity for a trend yet.' : 'Per-endpoint request metrics light up when the usage ledger is connected.'}
            </Text>
          )}
        </YStack>

        <YStack gap="$2">
          <Text fontSize="$3" fontWeight="700" color="$color12">Call this endpoint</Text>
          <CodeBlock>{call}</CodeBlock>
          <Text fontSize="$1" color="$color10">P95 latency and uptime appear per endpoint once observability is connected — never fabricated.</Text>
        </YStack>
      </YStack>
    </ScrollView>
  )
}

/** Open the endpoint detail slide-over (facts + real metrics + call sample + actions). */
export function openEndpointDetail(
  pane: DetailPaneApi,
  args: { endpoint: Endpoint; records: UsageRecord[]; hasLedger: boolean; nav: (path: string) => void },
) {
  const { endpoint, records, hasLedger, nav } = args
  pane.open({
    title: endpoint.name,
    subtitle: `${endpoint.type} · ${endpoint.kind === 'deployed' ? 'Deployed endpoint' : 'Managed endpoint'}`,
    content: <EndpointDetailBody endpoint={endpoint} records={records} hasLedger={hasLedger} />,
    footer: (
      <XStack gap="$2" flexWrap="wrap">
        <Button size="$3" onPress={() => nav('/inference/metrics')}>Metrics</Button>
        <Button size="$3" onPress={() => nav('/inference/status')}>Status</Button>
        <Button size="$3" onPress={() => nav('/inference/logs')}>Logs</Button>
        <Button size="$3" chromeless icon={<BookOpen size={15} />} onPress={() => openExternal(`${config.docsUrl}/docs/gateway`)}>
          Docs
        </Button>
      </XStack>
    ),
  })
}

/** A recorded-status pill (dot + label) — the dot's WEIGHT and the label carry the state. */
function LevelBadge({ level }: { level: string }) {
  const l = level.toLowerCase()
  const color = toneVar(l === 'error' || l === 'failed' || l === 'fail' ? 'critical' : l === 'success' || l === 'ok' ? 'positive' : 'muted')
  return (
    <XStack items="center" gap="$1.5">
      <StatusDot color={color} size={8} />
      <Text fontSize="$3" fontWeight="600" color="$color12">
        {level || 'unknown'}
      </Text>
    </XStack>
  )
}

/**
 * The log-row detail body — what actually happened for ONE recorded inference call.
 * Every value is REAL from the usage-ledger record (`logDetailFacts`); the full
 * prompt/response TEXT is not on the ledger row, so it is honestly stated as streaming
 * from observability once connected — never fabricated.
 */
function LogDetailBody({ line }: { line: LogLine }) {
  const facts = logDetailFacts(line.record, { usd: fmtUsd, count: fmtCount, time: (ms) => (ms != null ? new Date(ms).toLocaleString() : '—') })
  return (
    <ScrollView>
      <YStack gap="$4" p="$1">
        <YStack gap="$1.5">
          <Text fontSize="$2" color="$color10">Summary</Text>
          <Text fontSize="$3" color="$color11">{line.message}</Text>
        </YStack>

        <YStack>
          <XStack justify="space-between" items="center" gap="$3" py="$2" borderBottomWidth={1} borderColor="$borderColor">
            <Text fontSize="$2" color="$color10">Outcome</Text>
            <LevelBadge level={line.level} />
          </XStack>
          {facts
            .filter((f) => f.label !== 'Status')
            .map((f) => (
              <Fact key={f.label} label={f.label} value={f.value} />
            ))}
        </YStack>

        <YStack gap="$2">
          <Text fontSize="$3" fontWeight="700" color="$color12">Request &amp; response</Text>
          <YStack bg="$color1" borderWidth={1} borderColor="$borderColor" rounded="$4" p="$3" gap="$1.5">
            <Text fontSize="$2" color="$color11">
              This row is the org’s REAL usage-ledger entry for the call above. The full prompt and response text
              streams here from observability once its trace runtime is connected — until then it is not shown
              rather than fabricated.
            </Text>
          </YStack>
        </YStack>
      </YStack>
    </ScrollView>
  )
}

/** Open the log-row detail slide-over — the real recorded facts for one inference call. */
export function openLogDetail(pane: DetailPaneApi, args: { line: LogLine }) {
  const { line } = args
  pane.open({
    title: line.endpoint,
    subtitle: line.at ? new Date(line.at).toLocaleString() : 'Recorded inference call',
    content: <LogDetailBody line={line} />,
    footer: (
      <PrimaryButton chromeless onPress={() => pane.close()}>
        Close
      </PrimaryButton>
    ),
  })
}

/** A framework option for the minimal deploy form (KServe `modelFormat.name`). */
const FRAMEWORKS = ['sklearn', 'xgboost', 'tensorflow', 'pytorch', 'triton', 'huggingface']

const nameOk = (s: string) => /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(s)

/** The real deploy form — POSTs a KServe InferenceService and surfaces the true result. */
function DeployForm({ onDeployed, nav }: { onDeployed: () => void; nav: (path: string) => void }) {
  const [name, setName] = useState('')
  const [framework, setFramework] = useState('sklearn')
  const [storageUri, setStorageUri] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const submit = async () => {
    setError(null)
    if (!nameOk(name)) {
      setError("Name must be a DNS-1123 label (lower-case letters, digits, and '-').")
      return
    }
    if (!storageUri.trim()) {
      setError('A model storage URI is required (e.g. gs://…, s3://…, or a hf:// reference).')
      return
    }
    setBusy(true)
    try {
      await InferenceApi.deployEndpoint({
        name: name.trim(),
        spec: { predictor: { model: { modelFormat: { name: framework }, storageUri: storageUri.trim() } } },
      })
      setDone(true)
      onDeployed()
    } catch (e) {
      const msg = e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Deploy failed'
      const status = e instanceof ApiError ? e.status : 0
      setError(
        status === 403 || status === 401
          ? 'Deploying a serving endpoint is a workspace-admin action for your organization.'
          : status === 404 || status === 501
            ? 'The managed serving backend is not routed on this deployment yet. Deploy via Functions or Agents in the meantime.'
            : msg,
      )
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <YStack gap="$3" p="$1">
        <Text fontSize="$4" fontWeight="700" color="$color12">Endpoint “{name}” submitted</Text>
        <Text fontSize="$3" color="$color11">
          Your InferenceService is provisioning. It appears in the endpoints list with its live status as the
          cluster rolls it out — nothing is fabricated.
        </Text>
      </YStack>
    )
  }

  return (
    <ScrollView>
      <YStack gap="$4" p="$1">
        <Text fontSize="$3" color="$color11">
          Deploy a model as a scalable serving endpoint (a KServe InferenceService) in your org’s managed
          namespace. This is a real deploy — the cluster validates the spec and reports live status.
        </Text>

        <YStack gap="$1.5">
          <Text fontSize="$2" color="$color10">Endpoint name</Text>
          <Input value={name} onChangeText={setName} placeholder="my-llama" autoCapitalize="none" />
        </YStack>

        <YStack gap="$1.5">
          <Text fontSize="$2" color="$color10">Model format</Text>
          <XStack gap="$1" flexWrap="wrap">
            {FRAMEWORKS.map((f) => (
              <Button key={f} size="$2" bg={f === framework ? '$color5' : 'transparent'} borderWidth={1} borderColor="$borderColor" onPress={() => setFramework(f)}>
                {f}
              </Button>
            ))}
          </XStack>
        </YStack>

        <YStack gap="$1.5">
          <Text fontSize="$2" color="$color10">Model storage URI</Text>
          <Input value={storageUri} onChangeText={setStorageUri} placeholder="gs://bucket/model  ·  s3://bucket/model  ·  hf://org/model" autoCapitalize="none" />
        </YStack>

        {error ? (
          <Text fontSize="$2" style={{ color: toneVar('critical') }}>
            {error}
          </Text>
        ) : null}

        <XStack gap="$2" flexWrap="wrap">
          <AccentButton icon={<Rocket size={15} />} disabled={busy} onPress={submit}>
            {busy ? 'Deploying…' : 'Deploy endpoint'}
          </AccentButton>
        </XStack>

        <YStack gap="$2" pt="$2" borderTopWidth={1} borderColor="$borderColor">
          <Text fontSize="$2" color="$color10">Or deploy through a higher-level surface:</Text>
          <XStack gap="$2" flexWrap="wrap">
            <Button size="$2" onPress={() => nav('/functions')}>Functions</Button>
            <Button size="$2" onPress={() => nav('/agents')}>Agents</Button>
            <Button size="$2" onPress={() => nav('/playground')}>Playground</Button>
          </XStack>
        </YStack>
      </YStack>
    </ScrollView>
  )
}

/** Open the deploy slide-over — a real `POST /v1/ml/models` create + managed alternatives. */
export function openDeployPane(pane: DetailPaneApi, args: { onDeployed: () => void; nav: (path: string) => void }) {
  pane.open({
    title: 'Deploy endpoint',
    subtitle: 'Serve a model on managed Hanzo Cloud',
    icon: Rocket,
    content: <DeployForm onDeployed={args.onDeployed} nav={args.nav} />,
    footer: (
      <PrimaryButton chromeless onPress={() => pane.close()}>
        Close
      </PrimaryButton>
    ),
  })
}

/** Open an external URL in a new tab (SSR-guarded). */
export function openExternal(href: string): void {
  if (typeof window !== 'undefined') window.open(href, '_blank', 'noopener')
}
