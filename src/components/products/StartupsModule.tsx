'use client'

/**
 * Startups — the Hanzo Startup Program pipeline, over the REAL cloud
 * `/v1/crm/applications` surface (cloud `clients/crm`: a native-Go per-org
 * applications resource on Base/SQLite). A public marketing form
 * (hanzo.ai/startups) posts an application; an AI screen scores it; staff work it
 * through the pipeline HERE. Same-origin, keyless (`StartupsApi` →
 * `<origin>/v1/crm/applications`, rewritten to the user-bearer `/v1` proxy),
 * so every read/write is org-scoped SERVER-SIDE — the pipeline lives in `hanzo`.
 *
 * The pipeline is the SAME @hanzo/data `RecordsView` the CRM uses, defaulting to
 * the BOARD (lanes = pipeline stage). A card opens a detail drawer with every
 * submitted field, the AI screen (score / tier-1 / suggested credits / summary /
 * copy-able draft reply), the stage timeline, stage-advance buttons (PATCH the
 * application through the server stage machine), and a deep link into the
 * existing billing/deposit flow to grant credits. Read-only over live data +
 * stage mutations; every state is loading / BackendStateCard / empty.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useRouter } from '~/lib/router'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { Rocket, RefreshCw, Copy, Check, Gift, ArrowRight, Award } from '@hanzogui/lucide-icons-2'
import { RecordsView } from '@hanzo/data'

import { StartupsApi, STARTUP_STAGES, type Application } from '~/lib/api/startups'
import { STARTUP_FIELDS, STARTUP_STAGE_OPTIONS, applicationRecord } from './startups/collections'
import { SlideOver } from '~/components/ui/SlideOver'
import { BackendStateCard, PageHeader, classifyBackend, type BackendState } from '@hanzo/ui/product'

type Async<T> =
  | { phase: 'loading' }
  | { phase: 'error'; error: BackendState }
  | { phase: 'ready'; data: T }

const STAGE_LABEL = Object.fromEntries(STARTUP_STAGE_OPTIONS.map((o) => [o.value, o.label]))
const fmtUsd = (n: number): string => `$${(n || 0).toLocaleString('en-US')}`

/** The next forward stage (null at onboarded / off-pipeline). */
function nextStage(stage: string): string | null {
  const linear = STARTUP_STAGES.filter((s) => s !== 'rejected')
  const i = linear.indexOf(stage as (typeof linear)[number])
  return i >= 0 && i < linear.length - 1 ? linear[i + 1] : null
}

/** Small labelled key/value row. */
function KV({ label, value }: { label: string; value: string }) {
  if (!value) return null
  return (
    <XStack gap="$2" py="$1" borderBottomWidth={1} borderColor="$borderColor">
      <Text fontSize="$2" color="$color10" width={150}>{label}</Text>
      <Text fontSize="$2" flex={1} style={{ wordBreak: 'break-word' }}>{value}</Text>
    </XStack>
  )
}

/** A pill (stage / tier-1 / status). */
function Pill({ text, tone }: { text: string; tone?: 'green' | 'amber' | 'gray' | 'blue' }) {
  const bg = tone === 'green' ? '$green4' : tone === 'amber' ? '$yellow4' : tone === 'blue' ? '$color4' : '$color4'
  return (
    <Card bg={bg} px="$2" py="$1" borderRadius="$4">
      <Text fontSize="$1" fontWeight="700">{text}</Text>
    </Card>
  )
}

/** Copyable text block (the AI draft reply). */
function CopyBlock({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* clipboard blocked — no-op */ }
  }
  return (
    <Card p="$3" gap="$2" borderWidth={1} borderColor="$borderColor" bg="$color2">
      <XStack items="center" justify="space-between">
        <Text fontSize="$2" color="$color10" fontWeight="700">Draft reply</Text>
        <Button size="$1" icon={copied ? <Check size={13} /> : <Copy size={13} />} onPress={copy}>
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </XStack>
      <Text fontSize="$2" style={{ whiteSpace: 'pre-wrap' }}>{text}</Text>
    </Card>
  )
}

const META_LABELS: [string, string][] = [
  ['fundingStage', 'Funding stage'],
  ['investors', 'Investors'],
  ['amountRaised', 'Amount raised'],
  ['teamSize', 'Team size'],
  ['building', 'What they are building'],
  ['infraSpend', 'Infra spend / mo'],
  ['byoHardware', 'BYO hardware'],
  ['techstarsBatch', 'Techstars'],
  ['heardVia', 'Heard via'],
]

const asStr = (v: unknown): string =>
  Array.isArray(v) ? v.join(', ') : v == null ? '' : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : String(v)

/** The detail drawer: submitted data + AI screen + timeline + stage actions. */
function StartupDrawer({
  app, onClose, onAdvance, router,
}: {
  app: Application
  onClose: () => void
  onAdvance: (stage: string, reason?: string) => Promise<void>
  router: ReturnType<typeof useRouter>
}) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const s = app.screen
  const next = nextStage(app.stage)

  const act = async (stage: string, reason?: string) => {
    setBusy(true); setErr(null)
    try { await onAdvance(stage, reason) } catch (e) { setErr(e instanceof Error ? e.message : 'Failed') } finally { setBusy(false) }
  }
  const reject = () => {
    const reason = typeof window !== 'undefined' ? window.prompt('Reason for rejecting this application?') : ''
    if (reason && reason.trim()) void act('rejected', reason.trim())
  }

  return (
    <SlideOver open onClose={onClose} size={520} title={app.company || 'Application'} icon={Rocket}>
      <YStack gap="$3" p="$3">
        {/* Header pills */}
        <XStack gap="$2" flexWrap="wrap" items="center">
          <Pill text={STAGE_LABEL[app.stage] ?? app.stage} tone="blue" />
          {app.tier1 ? <Pill text="Tier-1 backed" tone="green" /> : null}
          {s.status === 'done' ? <Pill text={`AI score ${s.score}`} tone="amber" /> : <Pill text={`AI ${s.status}`} tone="gray" />}
        </XStack>

        {err ? <Text color="$red10" fontSize="$2">{err}</Text> : null}

        {/* Stage actions */}
        <XStack gap="$2" flexWrap="wrap">
          {next ? (
            <Button theme="green" size="$2" icon={<ArrowRight size={15} />} disabled={busy} onPress={() => void act(next)}>
              Advance to {STAGE_LABEL[next] ?? next}
            </Button>
          ) : null}
          {app.stage !== 'rejected' && app.stage !== 'onboarded' ? (
            <Button theme="red" size="$2" disabled={busy} onPress={reject}>Reject…</Button>
          ) : null}
          {app.stage === 'rejected' ? (
            <Button size="$2" disabled={busy} onPress={() => void act('applied')}>Reopen</Button>
          ) : null}
        </XStack>

        {/* AI screen */}
        <Card p="$3" gap="$2" borderWidth={1} borderColor="$borderColor">
          <XStack items="center" gap="$2">
            <Award size={16} />
            <Text fontSize="$3" fontWeight="700">AI screen</Text>
          </XStack>
          {s.status === 'done' ? (
            <>
              <KV label="Score" value={`${s.score} / 100`} />
              <KV label="Tier-1 backed" value={s.tier1Backed} />
              <KV label="Suggested credits" value={fmtUsd(s.suggestedCredits)} />
              <KV label="Summary" value={s.summary} />
              {s.draftReply ? <CopyBlock text={s.draftReply} /> : null}
              {s.suggestedCredits > 0 ? (
                <Button self="flex-start" size="$2" theme="blue" icon={<Gift size={15} />}
                  onPress={() => router.push(`/billing?grant=${s.suggestedCredits}`)}>
                  Grant {fmtUsd(s.suggestedCredits)} credits →
                </Button>
              ) : null}
            </>
          ) : (
            <Text fontSize="$2" color="$color10">
              {s.status === 'failed' ? `Screen failed${s.error ? ` — ${s.error}` : ''}. The application still landed.` : 'Screen pending — the AI is scoring this application.'}
            </Text>
          )}
        </Card>

        {/* Submitted data */}
        <Card p="$3" gap="$1" borderWidth={1} borderColor="$borderColor">
          <Text fontSize="$3" fontWeight="700" mb="$1">Application</Text>
          <KV label="Contact" value={app.contactName} />
          <KV label="Email" value={app.email} />
          <KV label="Role" value={app.role} />
          <KV label="Website" value={app.website} />
          {META_LABELS.map(([k, label]) => <KV key={k} label={label} value={asStr(app.metadata[k])} />)}
          {app.reason ? <KV label="Rejection reason" value={app.reason} /> : null}
        </Card>

        {/* Timeline */}
        {app.events.length ? (
          <Card p="$3" gap="$1" borderWidth={1} borderColor="$borderColor">
            <Text fontSize="$3" fontWeight="700" mb="$1">Timeline</Text>
            {app.events.map((ev, i) => (
              <XStack key={i} gap="$2" py="$1">
                <Text fontSize="$1" color="$color10" width={140}>
                  {ev.at ? new Date(ev.at * 1000).toLocaleString() : ''}
                </Text>
                <Text fontSize="$1" flex={1}>
                  {(STAGE_LABEL[ev.to] ?? ev.to)}{ev.by ? ` · ${ev.by}` : ''}{ev.note ? ` — ${ev.note}` : ''}
                </Text>
              </XStack>
            ))}
          </Card>
        ) : null}
      </YStack>
    </SlideOver>
  )
}

export function StartupsModule() {
  const router = useRouter()
  const [state, setState] = useState<Async<Application[]>>({ phase: 'loading' })
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const load = useCallback(() => {
    setState({ phase: 'loading' })
    StartupsApi.list()
      .then((data) => setState({ phase: 'ready', data }))
      .catch((e) => setState({ phase: 'error', error: classifyBackend(e) }))
  }, [])
  useEffect(() => { load() }, [load])

  const apps = state.phase === 'ready' ? state.data : []
  const records = useMemo(() => apps.map(applicationRecord), [apps])
  const selected = useMemo(() => apps.find((a) => a.id === selectedId) ?? null, [apps, selectedId])

  const counts = useMemo(() => {
    const by: Record<string, number> = {}
    for (const a of apps) by[a.stage] = (by[a.stage] ?? 0) + 1
    return by
  }, [apps])

  // Advance a stage through the server machine, then refresh.
  const advance = useCallback(async (id: string, stage: string, reason?: string) => {
    await StartupsApi.patch(id, { stage, reason })
    load()
  }, [load])

  // Board card drag → same PATCH (server validates the transition).
  const onRecordChange = useCallback(async (record: Record<string, unknown>, patch: Record<string, unknown>) => {
    const id = String(record.id)
    if (typeof patch.stage === 'string') await advance(id, patch.stage)
  }, [advance])

  return (
    <>
      <PageHeader
        title="Startups"
        subtitle="The Hanzo Startup Program pipeline — applications from hanzo.ai/startups, AI-screened. Drag a card or open it to advance the stage."
        actions={<Button size="$2" icon={<RefreshCw size={15} />} onPress={load}>Refresh</Button>}
      />

      {/* Stage count strip */}
      <XStack gap="$2" mb="$3" flexWrap="wrap">
        {STARTUP_STAGE_OPTIONS.map((o) => (
          <Card key={o.value} p="$2" minW={120} borderWidth={1} borderColor="$borderColor">
            <Text fontSize="$1" color="$color10">{o.label}</Text>
            <Text fontSize="$6" fontWeight="800">{counts[o.value] ?? 0}</Text>
          </Card>
        ))}
      </XStack>

      {state.phase === 'error' ? (
        <BackendStateCard state={state.error} onRetry={load} hint="endpoint · GET /v1/crm/applications" />
      ) : (
        <RecordsView
          fields={STARTUP_FIELDS}
          records={records}
          loading={state.phase === 'loading'}
          editable={false}
          defaultKind="board"
          onOpen={(r) => setSelectedId(String(r.id))}
          onRecordChange={onRecordChange}
          toolbarExtra={<XStack items="center" gap="$2"><Rocket size={15} /><Text fontSize="$2" color="$color10">{apps.length} applications</Text></XStack>}
          empty="No applications yet. They arrive from the public form at hanzo.ai/startups."
        />
      )}

      {selected ? (
        <StartupDrawer
          app={selected}
          onClose={() => setSelectedId(null)}
          onAdvance={(stage, reason) => advance(selected.id, stage, reason)}
          router={router}
        />
      ) : null}
    </>
  )
}

