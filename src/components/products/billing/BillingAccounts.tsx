'use client'

/**
 * Billing accounts — attach a billing account to the ORGANIZATION or to ONE PROJECT,
 * see the ORDERED chain that pays, and reorder it. The self-service surface for
 * "billing on the org; override per project".
 *
 * What the page shows is what commerce ACTUALLY charges: the chain is READ from
 * commerce's own resolver (`GET /v1/billing/chain`), never recomputed here. Commerce
 * decides the payer at charge time and is the one source of truth for who pays, so
 * this page writes a PRIORITY and re-reads the chain — it never predicts the order.
 * When the two disagree, you see commerce's answer, not ours.
 *
 * The chain reads top-down = charged first-first. The DEFAULT account (the anchor) is
 * derived from your billing subject: it is always present and cannot be detached, but
 * an attached account can be ordered ABOVE it to take over (a negative priority — how
 * an explicit binding preempts the derived subject). Attaching always lands at the
 * END, so adding an account never silently takes over today's payer.
 *
 * Scope tabs come from the caller's OWN projects (`useScope`, whose list the
 * `/org/iam` proxy pins to the caller's org) — we never fabricate a project. The
 * browser never names a holder id: it names a scope, and the `/billing` proxy derives
 * the holder from the session (`lib/server/billing-scope`).
 *
 * Honest states throughout: skeleton while loading, a truthful `BackendStateCard`
 * when the money-graph endpoints aren't served by this deployment (no fabricated
 * account, chain, or balance), and a rich empty when a scope has no override.
 */
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { ArrowDown, ArrowUp, Building2, FolderGit2, Plus, RefreshCw, Trash2 } from '@hanzogui/lucide-icons-2'

import { BillingAccountApi, type BillingAccount, type ChainLink } from '~/lib/api/billing-accounts'
import { fmtUsd } from '~/lib/api/functions'
import { useScope } from '~/lib/scope-context'
import {
  accountLabel,
  appendPriority,
  attachable,
  canMove,
  isDetachable,
  movedOrder,
  reorderWrites,
  sourceHint,
  sourceLabel,
  type ScopeTarget,
} from './accounts-logic'
import { BackendStateCard, EmptyState, PageHeader, classifyBackend, type BackendState } from '@hanzo/ui/product'

type Async<T> = { phase: 'loading' } | { phase: 'error'; error: BackendState } | { phase: 'ready'; data: T }
type Loaded = { chain: ChainLink[]; accounts: BillingAccount[] }

/** The scope tabs: the org default, then one per project the caller can see. */
function ScopeTabs({
  projects,
  target,
  onSelect,
}: {
  projects: string[]
  target: ScopeTarget
  onSelect: (t: ScopeTarget) => void
}) {
  const active = (t: ScopeTarget) =>
    t.holderKind === target.holderKind && (t.project ?? '') === (target.project ?? '')
  const tab = (t: ScopeTarget, label: string, icon: ReactElement) => (
    <Button
      key={`${t.holderKind}:${t.project ?? ''}`}
      size="$2"
      icon={icon}
      bg={active(t) ? '$color5' : 'transparent'}
      borderWidth={1}
      borderColor="$borderColor"
      onPress={() => onSelect(t)}
    >
      {label}
    </Button>
  )
  return (
    <XStack gap="$1" flexWrap="wrap">
      {tab({ holderKind: 'org' }, 'Organization', <Building2 size={14} />)}
      {projects.map((p) => tab({ holderKind: 'project', project: p }, p, <FolderGit2 size={14} />))}
    </XStack>
  )
}

/** One chain row: its charge position, the account, WHY it is there, and its controls. */
function ChainRow({
  link,
  index,
  total,
  busy,
  onMove,
  onDetach,
}: {
  link: ChainLink
  index: number
  total: number
  busy: boolean
  onMove: (dir: -1 | 1) => void
  onDetach: () => void
}) {
  return (
    <Card borderWidth={1} borderColor="$borderColor" p="$3" gap="$2">
      <XStack items="center" gap="$3" flexWrap="wrap">
        {/* Charge position — 1 pays first. */}
        <YStack width={26} height={26} rounded="$10" bg="$color4" items="center" justify="center">
          <Text fontSize="$2" fontWeight="700">
            {index + 1}
          </Text>
        </YStack>

        <YStack flex={1} minW={180} gap="$0.5">
          <Text fontSize="$3" fontWeight="600" numberOfLines={1}>
            {link.displayName || link.accountId}
          </Text>
          <Text fontSize="$1" color="$color10">
            {sourceLabel(link)} · priority {link.priority}
          </Text>
        </YStack>

        {/* Capacity — the balance that decides whether this account actually pays.
            Absent until commerce reports it; we never fabricate a number. */}
        <Text fontSize="$2" color="$color11">
          {link.balanceCents === undefined ? '—' : fmtUsd(link.balanceCents / 100)}
        </Text>

        <XStack gap="$1">
          <Button
            size="$2"
            chromeless
            icon={<ArrowUp size={14} />}
            disabled={busy || index === 0}
            onPress={() => onMove(-1)}
            aria-label={`Move ${link.accountId} up`}
          />
          <Button
            size="$2"
            chromeless
            icon={<ArrowDown size={14} />}
            disabled={busy || index === total - 1}
            onPress={() => onMove(1)}
            aria-label={`Move ${link.accountId} down`}
          />
          <Button
            size="$2"
            chromeless
            icon={<Trash2 size={14} />}
            disabled={busy || !isDetachable(link)}
            onPress={onDetach}
            aria-label={`Detach ${link.accountId}`}
          />
        </XStack>
      </XStack>
      <Text fontSize="$1" color="$color10">
        {sourceHint(link)}
      </Text>
    </Card>
  )
}

/** The attach affordance — the accounts not already in this scope's chain. */
function AttachRow({ options, busy, onAttach }: { options: BillingAccount[]; busy: boolean; onAttach: (id: string) => void }) {
  if (options.length === 0) return null
  return (
    <Card borderWidth={1} borderColor="$borderColor" p="$3" gap="$2">
      <Text fontSize="$2" color="$color11">
        Attach another account — it joins the END of the chain as a fallback.
      </Text>
      <XStack gap="$2" flexWrap="wrap">
        {options.map((a) => (
          <Button key={a.id} size="$2" icon={<Plus size={14} />} disabled={busy} onPress={() => onAttach(a.id)}>
            {accountLabel(a)}
          </Button>
        ))}
      </XStack>
    </Card>
  )
}

export function BillingAccounts({ params }: { params: Record<string, string> }) {
  void params
  const { projects } = useScope()
  const [target, setTarget] = useState<ScopeTarget>({ holderKind: 'org' })
  const [state, setState] = useState<Async<Loaded>>({ phase: 'loading' })
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    setState({ phase: 'loading' })
    // The chain is per-scope; the accounts list is the tenant's whole set.
    Promise.all([BillingAccountApi.chain(target.project), BillingAccountApi.accounts()])
      .then(([chain, accounts]) => setState({ phase: 'ready', data: { chain, accounts } }))
      .catch((e) => setState({ phase: 'error', error: classifyBackend(e) }))
  }, [target.project])

  useEffect(() => {
    load()
  }, [load])

  /** Run a money-graph write, then RE-READ the chain — commerce owns the order. */
  const commit = useCallback(
    async (write: () => Promise<unknown>) => {
      setBusy(true)
      try {
        await write()
        load()
      } catch (e) {
        setState({ phase: 'error', error: classifyBackend(e) })
      } finally {
        setBusy(false)
      }
    },
    [load],
  )

  const chain = state.phase === 'ready' ? state.data.chain : []
  const options = useMemo(
    () => (state.phase === 'ready' ? attachable(state.data.accounts, chain) : []),
    [state, chain],
  )

  const move = (i: number, dir: -1 | 1) => {
    if (!canMove(chain, i, dir)) return
    const writes = reorderWrites(chain, movedOrder(chain, i, dir))
    if (writes.length === 0) return
    // A reorder IS a re-bind: the binding id is deterministic in (holder, account),
    // so re-asserting the pair at a new priority updates that one row.
    void commit(async () => {
      for (const w of writes) {
        const link = chain.find((l) => l.bindingId === w.bindingId)
        if (link) await BillingAccountApi.bind(target, link.accountId, w.priority)
      }
    })
  }

  const attach = (accountId: string) =>
    void commit(() => BillingAccountApi.bind(target, accountId, appendPriority(chain)))

  const detach = (link: ChainLink) =>
    link.bindingId ? void commit(() => BillingAccountApi.unbind(link.bindingId as string)) : undefined

  return (
    <>
      <PageHeader
        title="Billing accounts"
        subtitle="Which account pays, and in what order. Billing sits on the organization by default; attach an account to a project to override it there. The chain reads top-down — the first account with the capacity to cover a charge pays it. This is read from commerce's own resolver, so it is exactly what gets charged."
        actions={
          <Button size="$2" icon={<RefreshCw size={15} />} onPress={load}>
            Refresh
          </Button>
        }
      />

      <ScopeTabs projects={projects.map((p) => p.name)} target={target} onSelect={setTarget} />

      {state.phase === 'loading' ? (
        <Card borderWidth={1} borderColor="$borderColor" p="$4">
          <Text fontSize="$2" color="$color10">
            Loading the payer chain…
          </Text>
        </Card>
      ) : state.phase === 'error' ? (
        <BackendStateCard state={state.error} onRetry={load} />
      ) : chain.length === 0 ? (
        <EmptyState
          icon={Building2}
          title="No payer resolved for this scope"
          description="Commerce resolved no account for this scope, so nothing here can be charged yet. Add credit or a payment method to create the account this scope bills to."
        />
      ) : (
        <YStack gap="$2">
          {chain.map((link, i) => (
            <ChainRow
              key={link.bindingId ?? link.accountId}
              link={link}
              index={i}
              total={chain.length}
              busy={busy}
              onMove={(dir) => move(i, dir)}
              onDetach={() => detach(link)}
            />
          ))}
          <AttachRow options={options} busy={busy} onAttach={attach} />
        </YStack>
      )}
    </>
  )
}

