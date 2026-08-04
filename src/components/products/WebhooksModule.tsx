'use client'

/**
 * Webhooks — deliver platform events to your own HTTPS endpoints (signed, retried,
 * logged). The org's outbound event destinations over the unified cloud binary via
 * the same-origin user-bearer `/v1` proxy, org resolved from the Bearer owner:
 *   - GET    /v1/webhooks                 list (secret NOT returned)
 *   - POST   /v1/webhooks                 create → the row incl. `secret` (reveal-once)
 *   - PATCH  /v1/webhooks/:id             enable/disable + edit
 *   - DELETE /v1/webhooks/:id             remove
 *   - POST   /v1/webhooks/:id/secret         → { secret } (reveal-once)
 *   - POST   /v1/webhooks/:id/test        → { delivered, httpStatus, durationMs, error? }
 *   - GET    /v1/webhooks/:id/deliveries  → recent attempts (newest-first)
 *
 * When the backend doesn't serve the LIST surface the load fails and the honest
 * not-configured / unavailable card renders instead of an empty grid (mirrors VPC /
 * LoadBalancer). The newer sub-features (test-send · rotate · deliveries · usage
 * counters) land from a sibling lane; each DEGRADES GRACEFULLY — a 404 hides that one
 * affordance rather than erroring the whole page. Nothing is fabricated: the reveal-
 * once secret is shown exactly once (create + rotate) and never re-fetched.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Input, ScrollView, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import {
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  KeyRound,
  Plus,
  Power,
  RefreshCw,
  ScrollText,
  Send,
  ShieldCheck,
  Trash2,
  Webhook,
} from '@hanzogui/lucide-icons-2'

import { ApiError, restGet, restPost, restDelete, restPatch, cloudProxyV1Url } from '~/lib/api/client'
import { PageHeader } from '~/components/ui/PageHeader'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { StatusTag } from '~/components/ui/StatusTag'
import { FieldRow, FieldText } from '~/components/ui/Field'
import { interpretPlatformError, PlatformStateCard, type PlatformError } from './platform/state'
import { VerifyCard } from './webhooks/VerifyCard'
import { SIGNATURE_SCHEME } from './webhooks/verify'

const enc = encodeURIComponent

/** The delivery signature scheme, shown inline so a dev knows how to verify a payload. */

type Webhook = {
  id: string
  url: string
  events: string[]
  status: string
  description?: string
  created?: string
  deliveries7d?: number
  failures7d?: number
  /** Present ONLY on the create/rotate response — reveal-once, never persisted. */
  secret?: string
}

type Delivery = {
  deliveryId: string
  subject: string
  attempt: number
  status: string
  httpStatus?: number
  error?: string
  durationMs?: number
  created?: string
}

type TestResult = { delivered: boolean; httpStatus?: number; durationMs?: number; error?: string }

const str = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const is404 = (e: unknown): boolean => e instanceof ApiError && e.status === 404
const msgOf = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/** Normalize a webhook row from whatever shape the endpoint returns (defensive). */
function normalizeWebhook(r: unknown, i: number): Webhook {
  const o = (r ?? {}) as Record<string, unknown>
  const events = Array.isArray(o.events)
    ? (o.events as unknown[]).map(str).filter(Boolean)
    : str(o.events)
      ? str(o.events).split(',').map((s) => s.trim()).filter(Boolean)
      : []
  return {
    id: str(o.id) || str(o.url) || `webhook-${i}`,
    url: str(o.url) || str(o.endpoint),
    events: events.length ? events : ['*'],
    status: str(o.status) || (o.enabled === false ? 'disabled' : 'active'),
    description: str(o.description) || undefined,
    created: str(o.created) || str(o.createdTime) || undefined,
    deliveries7d: num(o.deliveries7d),
    failures7d: num(o.failures7d),
    secret: str(o.secret) || undefined,
  }
}

/** Pull a `Webhook[]` from `{data:[…]}`, `{webhooks:[…]}`, or a bare array. */
function webhooksOf(payload: unknown): Webhook[] {
  const arr = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object'
      ? ((payload as Record<string, unknown>).data ?? (payload as Record<string, unknown>).webhooks)
      : null
  return Array.isArray(arr) ? arr.map(normalizeWebhook) : []
}

function normalizeDelivery(r: unknown, i: number): Delivery {
  const o = (r ?? {}) as Record<string, unknown>
  return {
    deliveryId: str(o.deliveryId) || str(o.id) || `delivery-${i}`,
    subject: str(o.subject) || str(o.event) || '—',
    attempt: num(o.attempt) ?? 1,
    status: str(o.status) || (o.delivered === false ? 'failed' : 'delivered'),
    httpStatus: num(o.httpStatus),
    error: str(o.error) || undefined,
    durationMs: num(o.durationMs),
    created: str(o.created) || str(o.createdTime) || undefined,
  }
}

const shortTime = (iso?: string): string => {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

// ── Small reusable copy control ─────────────────────────────────────────────────

function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <Button
      size="$2"
      icon={copied ? <Check size={14} /> : <Copy size={14} />}
      onPress={() =>
        void navigator.clipboard?.writeText(value).then(
          () => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1400)
          },
          () => undefined,
        )
      }
      aria-label={label}
    >
      {copied ? 'Copied' : label}
    </Button>
  )
}

/** Small event pill. */
function EventChip({ children }: { children: string }) {
  return (
    <Text fontSize="$1" px="$2" py="$1" rounded="$2" bg="$color3" color="$color11" className="mono" numberOfLines={1}>
      {children}
    </Text>
  )
}

// ── The reveal-once secret callout ──────────────────────────────────────────────

function SecretReveal({ title, url, secret, onDismiss }: { title: string; url: string; secret: string; onDismiss: () => void }) {
  return (
    <Card p="$4" gap="$3" borderWidth={1} borderColor="$yellow8" bg="$yellow2">
      <XStack gap="$2" items="center">
        <ShieldCheck size={16} color="$yellow11" />
        <Text fontSize="$5" fontWeight="700" color="$color12">
          {title}
        </Text>
        <XStack flex={1} />
        <Button size="$2" chromeless onPress={onDismiss} aria-label="Dismiss secret">
          Done
        </Button>
      </XStack>
      <Text fontSize="$2" color="$color11">
        Copy this signing secret now — for security it is shown only once and cannot be retrieved again. Store it where your
        endpoint <Text fontWeight="700">{url || 'receiver'}</Text> can read it.
      </Text>
      <XStack gap="$2" items="center" flexWrap="wrap">
        <Text flex={1} minW={200} fontSize="$2" color="$color12" className="mono" style={{ wordBreak: 'break-all' }}>
          {secret}
        </Text>
        <CopyButton value={secret} label="Copy secret" />
      </XStack>
      <Text fontSize="$1" color="$color10" className="mono">
        Verify each delivery: {SIGNATURE_SCHEME}
      </Text>
    </Card>
  )
}

// ── Per-endpoint deliveries (the Logs view) ─────────────────────────────────────

function DeliveriesPanel({
  webhookId,
  onUnavailable,
  lastTest,
}: {
  webhookId: string
  onUnavailable: () => void
  lastTest?: TestResult
}) {
  const [rows, setRows] = useState<Delivery[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [failedOnly, setFailedOnly] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const q = failedOnly ? '?limit=50&status=failed' : '?limit=50'
      const body = await restGet<unknown>(cloudProxyV1Url(`webhooks/${enc(webhookId)}/deliveries${q}`))
      const list = Array.isArray(body)
        ? body
        : Array.isArray((body as { data?: unknown[] })?.data)
          ? (body as { data: unknown[] }).data
          : []
      setRows(list.map(normalizeDelivery))
    } catch (e) {
      if (is404(e)) {
        onUnavailable()
        return
      }
      setError(msgOf(e))
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [webhookId, failedOnly, onUnavailable])

  useEffect(() => {
    void load()
  }, [load])

  const columns: Column<Delivery>[] = [
    { key: 'created', header: 'Time', width: 170, render: (d) => shortTime(d.created) },
    { key: 'subject', header: 'Event', render: (d) => <Text fontSize="$2" className="mono" numberOfLines={1}>{d.subject}</Text> },
    { key: 'attempt', header: 'Attempt', width: 80, align: 'right', mono: true, render: (d) => `#${d.attempt}` },
    {
      key: 'status',
      header: 'Result',
      width: 150,
      render: (d) => (
        <XStack gap="$2" items="center">
          <StatusTag status={d.status} />
          {d.httpStatus ? <Text fontSize="$1" color="$color10" className="mono">{d.httpStatus}</Text> : null}
        </XStack>
      ),
    },
    { key: 'durationMs', header: 'Duration', width: 90, align: 'right', mono: true, render: (d) => (d.durationMs != null ? `${d.durationMs}ms` : '—') },
    { key: 'error', header: 'Error', render: (d) => <Text fontSize="$1" color={d.error ? '$red10' : '$color10'} numberOfLines={1}>{d.error || '—'}</Text> },
  ]

  return (
    <YStack p="$3" gap="$3">
      {lastTest ? (
        <Card p="$3" gap="$1" borderWidth={1} borderColor={lastTest.delivered ? '$green8' : '$red8'} bg="$color2">
          <XStack gap="$2" items="center">
            {lastTest.delivered ? <Check size={14} color="$green10" /> : <Send size={14} color="$red10" />}
            <Text fontSize="$2" fontWeight="700" color="$color12">
              {lastTest.delivered ? 'Test delivered' : 'Test failed'}
            </Text>
          </XStack>
          <Text fontSize="$2" color="$color11" className="mono">
            {lastTest.delivered
              ? `HTTP ${lastTest.httpStatus ?? '—'} · ${lastTest.durationMs != null ? `${lastTest.durationMs}ms` : '—'}`
              : lastTest.error || `HTTP ${lastTest.httpStatus ?? '—'}`}
          </Text>
        </Card>
      ) : null}

      <XStack gap="$2" items="center" flexWrap="wrap">
        <ScrollText size={15} color="$color10" />
        <Text fontSize="$3" fontWeight="600" color="$color12">
          Recent deliveries
        </Text>
        <XStack flex={1} />
        <Button
          size="$2"
          chromeless
          bg={failedOnly ? '$color5' : 'transparent'}
          onPress={() => setFailedOnly((v) => !v)}
          aria-label="Show failed deliveries only"
        >
          {failedOnly ? 'Failed only ✓' : 'Failed only'}
        </Button>
        <Button size="$2" icon={<RefreshCw size={14} />} onPress={() => void load()} disabled={loading} aria-label="Refresh deliveries">
          Refresh
        </Button>
      </XStack>

      {error ? (
        <Text fontSize="$2" color="$red10">
          Could not load deliveries — {error}
        </Text>
      ) : (
        <DataTable
          columns={columns}
          rows={rows ?? []}
          loading={loading}
          rowKey={(d) => d.deliveryId}
          empty={failedOnly ? 'No failed deliveries — every recent attempt succeeded.' : 'No deliveries yet. Send a test, or wait for a matching event.'}
        />
      )}
    </YStack>
  )
}

// ── The product ─────────────────────────────────────────────────────────────────

export function WebhooksModule({ params }: { params: Record<string, string> }) {
  const [rows, setRows] = useState<Webhook[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<PlatformError | null>(null)

  // Create form
  const [url, setUrl] = useState('')
  const [events, setEvents] = useState('*')
  const [description, setDescription] = useState('')
  const [creating, setCreating] = useState(false)
  const [actionMsg, setActionMsg] = useState<{ tone: 'ok' | 'err'; text: string } | null>(null)

  // Reveal-once secret (create + rotate)
  const [revealed, setRevealed] = useState<{ title: string; url: string; secret: string } | null>(null)

  // Row-level state
  const [busyId, setBusyId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(params.view || null)
  const [tests, setTests] = useState<Record<string, TestResult>>({})

  // Sub-feature capability flags — flipped false on a 404 so the affordance HIDES
  // (the sibling lane is still landing these); the list itself never depends on them.
  const [testAvailable, setTestAvailable] = useState(true)
  const [rotateAvailable, setRotateAvailable] = useState(true)
  const [deliveriesAvailable, setDeliveriesAvailable] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await restGet<unknown>(cloudProxyV1Url('webhooks'))
      setRows(webhooksOf(r))
      setLoadError(null)
    } catch (e) {
      setLoadError(interpretPlatformError(e))
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const parseEvents = (raw: string): string[] => raw.split(',').map((s) => s.trim()).filter(Boolean)

  const onCreate = async () => {
    const u = url.trim()
    if (!u) {
      setActionMsg({ tone: 'err', text: 'Endpoint URL is required.' })
      return
    }
    if (!/^https:\/\//i.test(u)) {
      setActionMsg({ tone: 'err', text: 'Endpoint URL must be HTTPS.' })
      return
    }
    const evs = parseEvents(events)
    if (evs.length === 0) {
      setActionMsg({ tone: 'err', text: 'Add at least one event (or * for all).' })
      return
    }
    setCreating(true)
    setActionMsg(null)
    try {
      const row = await restPost<unknown>(cloudProxyV1Url('webhooks'), {
        url: u,
        events: evs,
        description: description.trim() || undefined,
      })
      const created = normalizeWebhook(row, rows.length)
      if (created.secret) setRevealed({ title: 'Signing secret', url: created.url || u, secret: created.secret })
      setActionMsg({ tone: 'ok', text: `Endpoint "${created.url || u}" created.` })
      setUrl('')
      setDescription('')
      setEvents('*')
      await load()
    } catch (e) {
      setActionMsg({ tone: 'err', text: msgOf(e) })
    } finally {
      setCreating(false)
    }
  }

  const onToggle = async (w: Webhook) => {
    const next = w.status === 'disabled' ? 'active' : 'disabled'
    setBusyId(w.id)
    setActionMsg(null)
    try {
      await restPatch(cloudProxyV1Url(`webhooks/${enc(w.id)}`), { status: next })
      setActionMsg({ tone: 'ok', text: `Endpoint ${next === 'active' ? 'enabled' : 'disabled'}.` })
      await load()
    } catch (e) {
      setActionMsg({ tone: 'err', text: `Could not update "${w.url || w.id}": ${msgOf(e)}` })
    } finally {
      setBusyId(null)
    }
  }

  const onDelete = async (w: Webhook) => {
    if (typeof window !== 'undefined' && !window.confirm(`Delete webhook endpoint "${w.url || w.id}"? This cannot be undone.`)) return
    setBusyId(w.id)
    setActionMsg(null)
    try {
      await restDelete(cloudProxyV1Url(`webhooks/${enc(w.id)}`))
      setActionMsg({ tone: 'ok', text: `Deleted "${w.url || w.id}".` })
      if (expandedId === w.id) setExpandedId(null)
      await load()
    } catch (e) {
      setActionMsg({ tone: 'err', text: `Could not delete "${w.url || w.id}": ${msgOf(e)}` })
    } finally {
      setBusyId(null)
    }
  }

  const onRotate = async (w: Webhook) => {
    if (typeof window !== 'undefined' && !window.confirm(`Rotate the signing secret for "${w.url || w.id}"? The old secret stops working immediately.`)) return
    setBusyId(w.id)
    setActionMsg(null)
    try {
      const res = await restPost<{ secret?: string }>(cloudProxyV1Url(`webhooks/${enc(w.id)}/secret`))
      const secret = str(res?.secret)
      if (secret) setRevealed({ title: 'New signing secret', url: w.url, secret })
      setActionMsg({ tone: 'ok', text: 'Signing secret rotated.' })
    } catch (e) {
      if (is404(e)) {
        setRotateAvailable(false)
        return
      }
      setActionMsg({ tone: 'err', text: `Could not rotate secret: ${msgOf(e)}` })
    } finally {
      setBusyId(null)
    }
  }

  const onTest = async (w: Webhook) => {
    setBusyId(w.id)
    setActionMsg(null)
    try {
      const res = await restPost<Partial<TestResult>>(cloudProxyV1Url(`webhooks/${enc(w.id)}/test`))
      const result: TestResult = {
        delivered: !!res?.delivered,
        httpStatus: num(res?.httpStatus),
        durationMs: num(res?.durationMs),
        error: str(res?.error) || undefined,
      }
      setTests((t) => ({ ...t, [w.id]: result }))
      setExpandedId(w.id) // surface the inline result
      setActionMsg(
        result.delivered
          ? { tone: 'ok', text: `Test delivered · HTTP ${result.httpStatus ?? '—'} · ${result.durationMs != null ? `${result.durationMs}ms` : '—'}` }
          : { tone: 'err', text: `Test failed · ${result.error || `HTTP ${result.httpStatus ?? '—'}`}` },
      )
    } catch (e) {
      if (is404(e)) {
        setTestAvailable(false)
        return
      }
      setActionMsg({ tone: 'err', text: `Could not send test: ${msgOf(e)}` })
    } finally {
      setBusyId(null)
    }
  }

  const hasUsage = rows.some((w) => w.deliveries7d != null || w.failures7d != null)

  const columns: Column<Webhook>[] = [
    {
      key: 'url',
      header: 'Endpoint',
      render: (w) => (
        <YStack gap={2} minW={0}>
          <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1} className="mono">
            {w.url || w.id}
          </Text>
          {w.description ? (
            <Text fontSize="$1" color="$color10" numberOfLines={1}>
              {w.description}
            </Text>
          ) : null}
        </YStack>
      ),
    },
    {
      key: 'events',
      header: 'Events',
      width: 200,
      render: (w) => (
        <XStack gap="$1" flexWrap="wrap">
          {w.events.slice(0, 3).map((e) => (
            <EventChip key={e}>{e}</EventChip>
          ))}
          {w.events.length > 3 ? <EventChip>{`+${w.events.length - 3}`}</EventChip> : null}
        </XStack>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: 110,
      render: (w) => <StatusTag status={w.status} />,
    },
    ...(hasUsage
      ? [
          {
            key: 'usage',
            header: '7d',
            width: 130,
            render: (w: Webhook) => (
              <Text fontSize="$2" color="$color11" className="mono">
                {w.deliveries7d ?? 0}
                {w.failures7d ? <Text color="$red10">{` · ${w.failures7d} failed`}</Text> : null}
              </Text>
            ),
          } as Column<Webhook>,
        ]
      : []),
    {
      key: 'actions',
      header: '',
      width: 300,
      render: (w) => {
        const busy = busyId === w.id
        return (
          <XStack gap="$1" justify="flex-end" flex={1} items="center">
            {testAvailable ? (
              <Button size="$2" chromeless icon={<Send size={13} />} disabled={busy} onPress={() => void onTest(w)} aria-label={`Send test to ${w.url || w.id}`}>
                Test
              </Button>
            ) : null}
            {rotateAvailable ? (
              <Button size="$2" chromeless icon={<KeyRound size={13} />} disabled={busy} onPress={() => void onRotate(w)} aria-label={`Rotate secret for ${w.url || w.id}`}>
                Rotate
              </Button>
            ) : null}
            <Button size="$2" chromeless icon={<Power size={13} />} disabled={busy} onPress={() => void onToggle(w)} aria-label={w.status === 'disabled' ? `Enable ${w.url || w.id}` : `Disable ${w.url || w.id}`}>
              {w.status === 'disabled' ? 'Enable' : 'Disable'}
            </Button>
            {deliveriesAvailable ? (
              <Button
                size="$2"
                chromeless
                icon={expandedId === w.id ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                onPress={() => setExpandedId((cur) => (cur === w.id ? null : w.id))}
                aria-label={`Deliveries for ${w.url || w.id}`}
              >
                Logs
              </Button>
            ) : null}
            <Button size="$2" chromeless theme="red" icon={busy ? <Spinner size="small" /> : <Trash2 size={13} />} disabled={busy} onPress={() => void onDelete(w)} aria-label={`Delete ${w.url || w.id}`} />
          </XStack>
        )
      },
    },
  ]

  return (
    <>
      <PageHeader
        title="Webhooks"
        subtitle="Deliver platform events to your endpoints — signed, retried, logged."
        actions={
          <Button icon={<RefreshCw size={16} />} onPress={() => void load()}>
            Refresh
          </Button>
        }
      />

      {loadError ? (
        <PlatformStateCard error={loadError} onRetry={() => void load()} />
      ) : (
        <>
          {revealed ? (
            <SecretReveal title={revealed.title} url={revealed.url} secret={revealed.secret} onDismiss={() => setRevealed(null)} />
          ) : null}

          <DataTable
            columns={columns}
            rows={rows}
            loading={loading}
            rowKey={(w) => w.id}
            empty="No webhook endpoints yet. Add one below to start receiving events."
            isRowExpanded={(w) => deliveriesAvailable && expandedId === w.id}
            renderExpanded={(w) => (
              <DeliveriesPanel
                webhookId={w.id}
                lastTest={tests[w.id]}
                onUnavailable={() => {
                  setDeliveriesAvailable(false)
                  setExpandedId(null)
                }}
              />
            )}
          />

          {/* Create */}
          <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor" maxWidth={560}>
            <XStack gap="$2" items="center">
              <Webhook size={16} />
              <Text fontSize="$5" fontWeight="700">
                New endpoint
              </Text>
            </XStack>
            <FieldRow label="Endpoint URL">
              <FieldText value={url} onChange={setUrl} placeholder="https://api.example.com/hooks/hanzo" />
            </FieldRow>
            <FieldRow label="Events">
              <YStack gap="$1">
                <FieldText value={events} onChange={setEvents} placeholder="*  or  commerce.order.created, agent.run.*" />
                <Text fontSize="$1" color="$color10">
                  Comma-separated. Use <Text className="mono">*</Text> for every event, or a prefix pattern like{' '}
                  <Text className="mono">commerce.&gt;</Text> / <Text className="mono">agent.run.*</Text> to match a family.
                </Text>
                <Text fontSize="$1" color="$color10">
                  Live subjects: <Text className="mono">commerce.order.*</Text> ·{' '}
                  <Text className="mono">commerce.checkout.*</Text> · <Text className="mono">commerce.&gt;</Text> — more event
                  streams coming.
                </Text>
              </YStack>
            </FieldRow>
            <FieldRow label="Description">
              <FieldText value={description} onChange={setDescription} placeholder="What this endpoint is for (optional)" />
            </FieldRow>
            <XStack gap="$3" items="center" flexWrap="wrap">
              <Button self="flex-start" theme="light" icon={<Plus size={16} />} disabled={creating} onPress={() => void onCreate()}>
                {creating ? 'Creating…' : 'Add endpoint'}
              </Button>
              {actionMsg ? (
                <Text fontSize="$2" color={actionMsg.tone === 'ok' ? '$color11' : '$red10'}>
                  {actionMsg.text}
                </Text>
              ) : null}
            </XStack>
            <XStack gap="$2" items="flex-start" pt="$1">
              <ShieldCheck size={14} color="$color10" />
              <Text fontSize="$1" color="$color10" flex={1}>
                On create we return a signing secret ONCE. Verify each delivery with{' '}
                <Text className="mono">{SIGNATURE_SCHEME}</Text> — compute the HMAC over the timestamped body and compare in
                constant time. Failed deliveries are retried with backoff and appear under each endpoint's Logs.
              </Text>
            </XStack>
          </Card>

          {/* Verify a delivery — signature scheme + copy-paste Node/Go verifiers. */}
          <VerifyCard />
        </>
      )}
    </>
  )
}
