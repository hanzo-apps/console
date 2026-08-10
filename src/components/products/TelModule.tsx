'use client'

/**
 * Telecom — the org's phone numbers, calls and messages over the REAL cloud
 * `/v1/tel` surface (cloud `apps/tel`: a carrier-agnostic, per-org telecom plane
 * on Base/SQLite). Every read/write is same-origin and keyless (`TelApi` →
 * `<origin>/v1/tel`, rewritten to the console's user-bearer `/v1` proxy), so every
 * row is org-scoped SERVER-SIDE and no credential reaches the browser.
 *
 * Three collections, one per level-2 tab, over the SAME primitives every other
 * product module uses — `PageHeader`, `SubNav`, `DataTable`, `SlideOver`,
 * `Field*`, `ConfirmDelete`, `BackendStateCard`, `EmptyState`, `useToast`. There
 * is no bespoke chrome here and there must not be.
 *
 * A NUMBER IS THE PRECONDITION for both other collections, which is why Numbers is
 * the index: the backend refuses a call or a message whose `from` is not a number
 * this org holds (`store.NumberByE164` → 403). So `from` is a SELECT over the held
 * numbers rather than a text field — the one shape that cannot compose a request
 * the backend will reject. With no numbers held, the Calls and Messages tabs say
 * so and offer the buy flow instead of a form that could only fail.
 *
 * Honest by construction: loading paints skeleton rows, a `/v1/tel` failure paints
 * `BackendStateCard` with the endpoint that failed, and zero rows paints a real
 * empty state. Nothing is fabricated. Until the `tel` plugin is deployed the
 * endpoint 404s and every panel says exactly that.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Text, XStack, YStack } from '@hanzo/gui'
import { MessageSquare, Phone, PhoneCall, Plus, RefreshCw, Search, Send, Trash2 } from '@hanzogui/lucide-icons-2'

import {
  TelApi,
  NUMBER_TYPES,
  rate,
  type Call,
  type Message,
  type Number as TelNumber,
  type Summary,
} from '~/lib/api/tel'
import { SubNav } from '~/components/ui/SubNav'
import { SlideOver } from '~/components/ui/SlideOver'
import { useToast } from '~/components/ui/Toast'
// The value/label picker is the one Field the package does not carry.
import { FieldOptionSelect } from '~/components/ui/Field'
import { productSubpageSlug } from '~/lib/products/match'
import {
  BackendStateCard,
  ConfirmDelete,
  DataTable,
  EmptyState,
  FieldRow,
  FieldSelect,
  FieldSwitch,
  FieldText,
  PageHeader,
  PrimaryButton,
  StatusTag,
  classifyBackend,
  type BackendState,
  type Column,
} from '@hanzo/ui/product'

type Async<T> = { phase: 'loading' } | { phase: 'error'; error: BackendState } | { phase: 'ready'; data: T }

type Tab = 'numbers' | 'calls' | 'messages'

/** Which drawer is open, and over what. One union — one SlideOver. */
type Dialog =
  | { kind: 'none' }
  | { kind: 'buy' }
  | { kind: 'call' }
  | { kind: 'message' }
  | { kind: 'release'; number: TelNumber }
  | { kind: 'hangup'; call: Call }

/** A call still in progress can be hung up; a finished one cannot. */
const isLive = (c: Call): boolean => c.status !== 'completed' && c.status !== 'failed'

/** The per-org summary bar (real `/v1/tel/summary` counts). */
function SummaryBar({ summary }: { summary: Summary | null }) {
  const cells: { label: string; value: number | string }[] = [
    { label: 'Numbers', value: summary ? summary.numbers : '—' },
    { label: 'Calls', value: summary ? summary.calls : '—' },
    { label: 'Messages', value: summary ? summary.messages : '—' },
  ]
  return (
    <XStack gap="$3" flexWrap="wrap">
      {cells.map((c) => (
        <YStack key={c.label} gap="$1" borderWidth={1} borderColor="$borderColor" rounded="$4" px="$4" py="$3" minW={140}>
          <Text fontSize="$1" color="$color10">{c.label}</Text>
          <Text fontSize="$6" fontWeight="500" className="hz-tnum">{c.value}</Text>
        </YStack>
      ))}
    </XStack>
  )
}

// ── Forms (rendered inside the shared SlideOver) ────────────────────────────

/**
 * Search the carrier's inventory, then buy a row. Two real calls, in the order the
 * backend enforces: `country` is required by `/numbers/available`, so nothing is
 * requested until one is entered. A search is not a holding — the rows here are the
 * carrier's, and only `buy` records anything.
 */
function BuyForm({ onDone }: { onDone: () => void }) {
  const toast = useToast()
  const [country, setCountry] = useState('US')
  const [area, setArea] = useState('')
  const [type, setType] = useState('')
  const [found, setFound] = useState<TelNumber[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [buying, setBuying] = useState('')
  const [err, setErr] = useState<string | null>(null)

  const search = async () => {
    if (!country.trim()) {
      setErr('A country is required — numbering is national.')
      return
    }
    setBusy(true)
    setErr(null)
    try {
      setFound(await TelApi.numbers.available({ country: country.trim().toUpperCase(), area: area.trim(), type }))
    } catch (e) {
      setErr(classifyBackend(e).message || 'Could not search the carrier.')
    } finally {
      setBusy(false)
    }
  }

  const buy = async (n: TelNumber) => {
    setBuying(n.e164)
    setErr(null)
    try {
      await TelApi.numbers.buy(n.e164)
      toast.success(`Bought ${n.e164}`)
      onDone()
    } catch (e) {
      setErr(classifyBackend(e).message || 'Could not buy that number.')
      setBuying('')
    }
  }

  return (
    <YStack gap="$3">
      <FieldRow label="Country">
        <FieldText value={country} onChange={setCountry} placeholder="US" disabled={busy} />
      </FieldRow>
      <FieldRow label="Area code">
        <FieldText value={area} onChange={setArea} placeholder="415 (optional)" disabled={busy} />
      </FieldRow>
      <FieldRow label="Type">
        <FieldSelect value={type} options={[...NUMBER_TYPES]} onChange={setType} disabled={busy} placeholder="Any type" />
      </FieldRow>
      {err ? <Text fontSize="$2" color="$red10">{err}</Text> : null}
      <Button self="flex-start" icon={<Search size={15} />} disabled={busy} onPress={() => void search()}>
        {busy ? 'Searching…' : 'Search carrier'}
      </Button>

      {found ? (
        found.length === 0 ? (
          <Text fontSize="$2" color="$color10">
            The carrier has nothing available for that search. Try another area code or type.
          </Text>
        ) : (
          <YStack gap="$2" borderTopWidth={1} borderColor="$borderColor" pt="$3">
            {found.map((n) => (
              <XStack key={n.e164} items="center" justify="space-between" gap="$3">
                <YStack minW={0} flex={1}>
                  <Text fontSize="$3" className="hz-mono" color="$color12" numberOfLines={1}>{n.e164}</Text>
                  <Text fontSize="$1" color="$color10">
                    {[n.type, n.capable.join(' · '), rate(n.monthly, n.currency)].filter(Boolean).join(' — ')}
                  </Text>
                </YStack>
                <Button size="$2" disabled={buying !== ''} onPress={() => void buy(n)}>
                  {buying === n.e164 ? 'Buying…' : 'Buy'}
                </Button>
              </XStack>
            ))}
          </YStack>
        )
      ) : null}
    </YStack>
  )
}

/**
 * Place a call. `from` is a select over the numbers this org HOLDS, because the
 * backend refuses any other caller ID (403) — a text field could only compose a
 * request that fails. `agent` hands the call to a Hanzo assistant; with no
 * assistant plane configured the backend answers 424 and the drawer says so.
 */
function CallForm({ held, onDone }: { held: TelNumber[]; onDone: () => void }) {
  const toast = useToast()
  const [from, setFrom] = useState(held[0]?.e164 ?? '')
  const [to, setTo] = useState('')
  const [agent, setAgent] = useState('')
  const [record, setRecord] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const options = useMemo(() => held.map((n) => ({ value: n.e164, label: n.e164 })), [held])

  const submit = async () => {
    if (!from || !to.trim()) {
      setErr('A number to call from and a number to call are both required.')
      return
    }
    setBusy(true)
    setErr(null)
    try {
      const c = await TelApi.calls.place({ from, to: to.trim(), agent: agent.trim() || undefined, record })
      toast.success(`Calling ${c.to}`, `Status ${c.status}`)
      onDone()
    } catch (e) {
      setErr(classifyBackend(e).message || 'Could not place the call.')
      setBusy(false)
    }
  }

  return (
    <YStack gap="$3">
      <FieldRow label="From">
        <FieldOptionSelect value={from} options={options} onChange={setFrom} disabled={busy} placeholder="Pick a number you hold" />
      </FieldRow>
      <FieldRow label="To">
        <FieldText value={to} onChange={setTo} placeholder="+14155550123" disabled={busy} />
      </FieldRow>
      <FieldRow label="Assistant">
        <FieldText value={agent} onChange={setAgent} placeholder="Leave empty to connect a person" disabled={busy} />
      </FieldRow>
      <FieldRow label="Record">
        <FieldSwitch checked={record} onChange={setRecord} disabled={busy} />
      </FieldRow>
      <Text fontSize="$2" color="$color10">
        An assistant answers on Hanzo inference — the carrier moves the audio and does not decide what is said.
      </Text>
      {err ? <Text fontSize="$2" color="$red10">{err}</Text> : null}
      <PrimaryButton onPress={() => void submit()} disabled={busy} icon={<PhoneCall size={16} />}>
        {busy ? 'Dialing…' : 'Place call'}
      </PrimaryButton>
    </YStack>
  )
}

/** Send a message. Same `from` rule as a call, for the same backend reason. */
function MessageForm({ held, onDone }: { held: TelNumber[]; onDone: () => void }) {
  const toast = useToast()
  const [from, setFrom] = useState(held[0]?.e164 ?? '')
  const [to, setTo] = useState('')
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const options = useMemo(() => held.map((n) => ({ value: n.e164, label: n.e164 })), [held])

  const submit = async () => {
    if (!from || !to.trim()) {
      setErr('A number to send from and a number to send to are both required.')
      return
    }
    if (!text.trim()) {
      setErr('A message needs text.')
      return
    }
    setBusy(true)
    setErr(null)
    try {
      await TelApi.messages.send({ from, to: to.trim(), text: text.trim() })
      toast.success(`Queued to ${to.trim()}`, 'The carrier has accepted it; delivery is reported separately.')
      onDone()
    } catch (e) {
      setErr(classifyBackend(e).message || 'Could not send the message.')
      setBusy(false)
    }
  }

  return (
    <YStack gap="$3">
      <FieldRow label="From">
        <FieldOptionSelect value={from} options={options} onChange={setFrom} disabled={busy} placeholder="Pick a number you hold" />
      </FieldRow>
      <FieldRow label="To">
        <FieldText value={to} onChange={setTo} placeholder="+14155550123" disabled={busy} />
      </FieldRow>
      <FieldRow label="Message">
        <FieldText value={text} onChange={setText} placeholder="Your message" disabled={busy} />
      </FieldRow>
      {err ? <Text fontSize="$2" color="$red10">{err}</Text> : null}
      <PrimaryButton onPress={() => void submit()} disabled={busy} icon={<Send size={16} />}>
        {busy ? 'Sending…' : 'Send message'}
      </PrimaryButton>
    </YStack>
  )
}

// ── Module ──────────────────────────────────────────────────────────────────

export function TelModule({ params }: { params: Record<string, string> }) {
  const active: Tab = (productSubpageSlug('tel', params.tab) || 'numbers') as Tab

  const [summary, setSummary] = useState<Summary | null>(null)
  const [numbers, setNumbers] = useState<Async<TelNumber[]>>({ phase: 'loading' })
  const [calls, setCalls] = useState<Async<Call[]>>({ phase: 'loading' })
  const [messages, setMessages] = useState<Async<Message[]>>({ phase: 'loading' })
  const [dialog, setDialog] = useState<Dialog>({ kind: 'none' })

  const loadNumbers = useCallback(() => {
    setNumbers({ phase: 'loading' })
    TelApi.numbers
      .list()
      .then((data) => setNumbers({ phase: 'ready', data }))
      .catch((e) => setNumbers({ phase: 'error', error: classifyBackend(e) }))
  }, [])

  const loadCalls = useCallback(() => {
    setCalls({ phase: 'loading' })
    TelApi.calls
      .list()
      .then((data) => setCalls({ phase: 'ready', data }))
      .catch((e) => setCalls({ phase: 'error', error: classifyBackend(e) }))
  }, [])

  const loadMessages = useCallback(() => {
    setMessages({ phase: 'loading' })
    TelApi.messages
      .list()
      .then((data) => setMessages({ phase: 'ready', data }))
      .catch((e) => setMessages({ phase: 'error', error: classifyBackend(e) }))
  }, [])

  // The summary is the header on every tab, so it reloads with any of them.
  const loadSummary = useCallback(() => {
    TelApi.summary().then(setSummary).catch(() => setSummary(null))
  }, [])

  useEffect(() => {
    loadSummary()
    loadNumbers()
  }, [loadSummary, loadNumbers])

  useEffect(() => {
    if (active === 'calls') loadCalls()
    if (active === 'messages') loadMessages()
  }, [active, loadCalls, loadMessages])

  /** Held numbers, for the `from` select — empty until the list has loaded. */
  const held = numbers.phase === 'ready' ? numbers.data : []

  const close = useCallback(() => setDialog({ kind: 'none' }), [])
  const afterNumbers = useCallback(() => {
    close()
    loadNumbers()
    loadSummary()
  }, [close, loadNumbers, loadSummary])
  const afterCalls = useCallback(() => {
    close()
    loadCalls()
    loadSummary()
  }, [close, loadCalls, loadSummary])
  const afterMessages = useCallback(() => {
    close()
    loadMessages()
    loadSummary()
  }, [close, loadMessages, loadSummary])

  // ── Column defs ──
  const numberColumns: Column<TelNumber>[] = [
    {
      key: 'e164',
      header: 'Number',
      render: (n) => (
        <XStack items="center" gap="$2" flex={1} minW={0}>
          <Phone size={14} color="$color11" />
          <Text fontSize="$3" className="hz-mono" color="$color12" numberOfLines={1}>{n.e164}</Text>
        </XStack>
      ),
    },
    { key: 'country', header: 'Country', width: 100, render: (n) => <Text fontSize="$2" color="$color11">{n.country || '—'}</Text> },
    { key: 'type', header: 'Type', width: 110, render: (n) => <Text fontSize="$2" color="$color11">{n.type || '—'}</Text> },
    {
      key: 'capable',
      header: 'Carries',
      render: (n) => <Text fontSize="$2" color="$color11" numberOfLines={1}>{n.capable.length ? n.capable.join(' · ') : '—'}</Text>,
    },
    { key: 'monthly', header: 'Monthly', width: 120, align: 'right', mono: true, render: (n) => rate(n.monthly, n.currency) },
    {
      key: 'actions',
      header: '',
      width: 60,
      align: 'right',
      render: (n) => (
        <XStack justify="flex-end">
          <Button chromeless width={44} height={44} icon={<Trash2 size={15} />} aria-label={`Release ${n.e164}`} onPress={() => setDialog({ kind: 'release', number: n })} />
        </XStack>
      ),
    },
  ]

  const callColumns: Column<Call>[] = [
    { key: 'from', header: 'From', render: (c) => <Text fontSize="$3" className="hz-mono" color="$color12" numberOfLines={1}>{c.from}</Text> },
    { key: 'to', header: 'To', render: (c) => <Text fontSize="$3" className="hz-mono" color="$color12" numberOfLines={1}>{c.to}</Text> },
    {
      key: 'agent',
      header: 'Answered by',
      width: 160,
      render: (c) => <Text fontSize="$2" color="$color11" numberOfLines={1}>{c.agent || 'A person'}</Text>,
    },
    { key: 'status', header: 'Status', width: 120, render: (c) => <StatusTag status={c.status} /> },
    {
      key: 'actions',
      header: '',
      width: 60,
      align: 'right',
      render: (c) =>
        isLive(c) ? (
          <XStack justify="flex-end">
            <Button chromeless width={44} height={44} icon={<Trash2 size={15} />} aria-label={`Hang up the call to ${c.to}`} onPress={() => setDialog({ kind: 'hangup', call: c })} />
          </XStack>
        ) : null,
    },
  ]

  const messageColumns: Column<Message>[] = [
    { key: 'from', header: 'From', width: 170, render: (m) => <Text fontSize="$3" className="hz-mono" color="$color12" numberOfLines={1}>{m.from}</Text> },
    { key: 'to', header: 'To', width: 170, render: (m) => <Text fontSize="$3" className="hz-mono" color="$color12" numberOfLines={1}>{m.to}</Text> },
    { key: 'text', header: 'Message', render: (m) => <Text fontSize="$3" color="$color12" numberOfLines={1}>{m.text}</Text> },
    { key: 'status', header: 'Status', width: 120, render: (m) => <StatusTag status={m.status} /> },
  ]

  /** A call or a message needs a number first — say that instead of a form that 403s. */
  const needsNumber = (
    <EmptyState
      icon={Phone}
      title="Buy a number first"
      description="A call and a message both go out from a number this organization holds — the backend refuses any other caller ID."
      primary={{ label: 'Buy a number', onPress: () => setDialog({ kind: 'buy' }) }}
    />
  )

  return (
    <YStack gap="$4" p="$4">
      <PageHeader
        title="Telecom"
        subtitle="Phone numbers, calls and messages for your organization — on whatever carrier this deployment runs."
        actions={
          <>
            {active === 'numbers' ? (
              <PrimaryButton onPress={() => setDialog({ kind: 'buy' })} icon={<Plus size={16} />}>
                Buy a number
              </PrimaryButton>
            ) : null}
            {active === 'calls' && held.length > 0 ? (
              <PrimaryButton onPress={() => setDialog({ kind: 'call' })} icon={<PhoneCall size={16} />}>
                Place a call
              </PrimaryButton>
            ) : null}
            {active === 'messages' && held.length > 0 ? (
              <PrimaryButton onPress={() => setDialog({ kind: 'message' })} icon={<Send size={16} />}>
                Send a message
              </PrimaryButton>
            ) : null}
            <Button
              icon={<RefreshCw size={16} />}
              onPress={() => {
                loadSummary()
                if (active === 'numbers') loadNumbers()
                if (active === 'calls') loadCalls()
                if (active === 'messages') loadMessages()
              }}
            >
              Refresh
            </Button>
          </>
        }
      />

      <SubNav id="tel" />
      <SummaryBar summary={summary} />

      {active === 'numbers' ? (
        numbers.phase === 'error' ? (
          <BackendStateCard state={numbers.error} onRetry={loadNumbers} hint="endpoint · GET /v1/tel/numbers" />
        ) : numbers.phase === 'ready' && numbers.data.length === 0 ? (
          <EmptyState
            icon={Phone}
            title="No numbers yet"
            description="Buy a number to start placing calls and sending messages from this organization."
            primary={{ label: 'Buy a number', onPress: () => setDialog({ kind: 'buy' }) }}
          />
        ) : (
          <DataTable<TelNumber>
            columns={numberColumns}
            rows={numbers.phase === 'ready' ? numbers.data : []}
            loading={numbers.phase === 'loading'}
            empty="No numbers yet."
            rowKey={(n) => n.id}
          />
        )
      ) : null}

      {active === 'calls' ? (
        calls.phase === 'error' ? (
          <BackendStateCard state={calls.error} onRetry={loadCalls} hint="endpoint · GET /v1/tel/calls" />
        ) : calls.phase === 'ready' && calls.data.length === 0 ? (
          held.length === 0 ? (
            needsNumber
          ) : (
            <EmptyState
              icon={PhoneCall}
              title="No calls yet"
              description="Place a call from one of your numbers. Hand it to a Hanzo assistant, or connect a person."
              primary={{ label: 'Place a call', onPress: () => setDialog({ kind: 'call' }) }}
            />
          )
        ) : (
          <DataTable<Call>
            columns={callColumns}
            rows={calls.phase === 'ready' ? calls.data : []}
            loading={calls.phase === 'loading'}
            empty="No calls yet."
            rowKey={(c) => c.id}
          />
        )
      ) : null}

      {active === 'messages' ? (
        messages.phase === 'error' ? (
          <BackendStateCard state={messages.error} onRetry={loadMessages} hint="endpoint · GET /v1/tel/messages" />
        ) : messages.phase === 'ready' && messages.data.length === 0 ? (
          held.length === 0 ? (
            needsNumber
          ) : (
            <EmptyState
              icon={MessageSquare}
              title="No messages yet"
              description="Send a message from one of your numbers. Delivery is reported separately from acceptance."
              primary={{ label: 'Send a message', onPress: () => setDialog({ kind: 'message' }) }}
            />
          )
        ) : (
          <DataTable<Message>
            columns={messageColumns}
            rows={messages.phase === 'ready' ? messages.data : []}
            loading={messages.phase === 'loading'}
            empty="No messages yet."
            rowKey={(m) => m.id}
          />
        )
      ) : null}

      {/* ONE SlideOver, content by dialog kind. */}
      <SlideOver
        open={dialog.kind !== 'none'}
        onClose={close}
        title={
          dialog.kind === 'buy'
            ? 'Buy a number'
            : dialog.kind === 'call'
              ? 'Place a call'
              : dialog.kind === 'message'
                ? 'Send a message'
                : dialog.kind === 'release'
                  ? `Release ${dialog.number.e164}`
                  : dialog.kind === 'hangup'
                    ? `Hang up ${dialog.call.to}`
                    : ''
        }
        icon={dialog.kind === 'message' ? MessageSquare : dialog.kind === 'call' || dialog.kind === 'hangup' ? PhoneCall : Phone}
        ariaLabel="Telecom dialog"
      >
        {dialog.kind === 'buy' ? (
          <BuyForm onDone={afterNumbers} />
        ) : dialog.kind === 'call' ? (
          <CallForm held={held} onDone={afterCalls} />
        ) : dialog.kind === 'message' ? (
          <MessageForm held={held} onDone={afterMessages} />
        ) : dialog.kind === 'release' ? (
          <ConfirmDelete
            message={`Release ${dialog.number.e164} back to the carrier? The number stops reaching this organization and cannot be reclaimed.`}
            confirmLabel="Release number"
            run={() => TelApi.numbers.release(dialog.number.id)}
            onDone={afterNumbers}
          />
        ) : dialog.kind === 'hangup' ? (
          <ConfirmDelete
            message={`End the call to ${dialog.call.to}? The record stays; the call does not.`}
            confirmLabel="Hang up"
            run={() => TelApi.calls.hangup(dialog.call.id)}
            onDone={afterCalls}
          />
        ) : null}
      </SlideOver>
    </YStack>
  )
}

export default TelModule
