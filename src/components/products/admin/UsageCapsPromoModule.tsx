'use client'

/**
 * Usage Caps & Promo (admin) — the SuperAdmin config surface on admin.<brand> for two
 * platform levers, two tabs, ONE module:
 *
 *   1. PROMO — view + edit the SINGLE platform plan promo (percent off, an optional
 *      start/end window, the paid plans it applies to, and an active toggle). Backed by
 *      the cloud `GET/PUT /v1/admin/promos` singleton.
 *   2. CAPS — oversight + override of ANY org's usage caps: pick a target org, list its
 *      spend caps (real threshold / period-spend meter / hard-cap vs alert / rate limit /
 *      when it resets), and create / edit / delete a cap on that org's behalf. Backed by
 *      `GET/POST/PATCH/DELETE /v1/admin/spend-caps?org=<slug>`.
 *
 * All reads/writes terminate at the GLOBAL-ADMIN-GATED `app/admin/aggregate` proxy
 * (`getAdminGate`, fail-closed 403, then a minted user bearer + same-origin CSRF), and
 * `admin: true` hides the entry from every customer. This module is ALSO gated
 * client-side on `useIsSuperAdmin` (UI defense-in-depth, never the boundary).
 *
 * The caps model is the tenant `SpendAlert` primitive, so `budgets-logic.ts` (the
 * verdict / meter / scope / form helpers the customer Budgets page uses) is reused
 * verbatim — one caps model, no fork. Money is USD cents; displayed as dollars.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import {
  Ban,
  Building2,
  Check,
  CircleDollarSign,
  FolderGit2,
  Gift,
  Plus,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  TriangleAlert,
} from '@hanzogui/lucide-icons-2'

import { useIsSuperAdmin } from '~/lib/auth/admin'
import { ApiError } from '~/lib/api'
import { AdminPromosApi, type PlatformPromo } from '~/lib/api/admin-promos'
import { AdminSpendCapsApi, type AdminSpendCap } from '~/lib/api/admin-spend-caps'
import { fmtInt, fmtUsd } from '~/lib/api/functions'
import { PageHeader } from '~/components/ui/PageHeader'
import { EmptyState } from '~/components/ui/EmptyState'
import { MetricCard } from '~/components/ui/Metric'
import { Panel } from '~/components/ui/Panel'
import { PrimaryButton } from '~/components/ui/PrimaryButton'
import { FieldRow, FieldSelect, FieldSwitch, FieldText, FieldSlider } from '~/components/ui/Field'
import { asApiError, ErrorState, isForbidden, OperatorAccessRequired } from '~/components/ui/States'
import {
  capVerdict,
  deriveBudgetsSummary,
  formForAlert,
  isOrgDefault,
  meterColor,
  scopeLabel,
  spendPct,
  validateBudgetForm,
  VERDICT_LABEL,
  type BudgetForm,
  type CapVerdict,
  type ScopeType,
} from '~/components/products/billing/budgets-logic'
import { formForPromo, promoSummary, validatePromoForm, type PromoForm } from './promo-logic'

type Async<T> = { phase: 'loading' } | { phase: 'error'; err: ApiError } | { phase: 'ready'; data: T }

// ── Shared tiny presentational primitives (self-contained — no cross-surface coupling) ──

function Loading({ label }: { label: string }) {
  return (
    <Card p="$4" borderWidth={1} borderColor="$borderColor">
      <Text color="$color10">{label}</Text>
    </Card>
  )
}

function Note({ message, tone = 'info' }: { message: string; tone?: 'info' | 'error' }) {
  const isErr = tone === 'error'
  return (
    <XStack items="center" gap="$2">
      {/* A success confirmation reads as a green check, never a warning triangle. */}
      {isErr ? <TriangleAlert size={14} color="$red11" /> : <Check size={14} color="$green11" />}
      <Text fontSize="$2" color={isErr ? '$red11' : '$color11'}>
        {message}
      </Text>
    </XStack>
  )
}

/** A labeled read-only fact. */
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <YStack minW={110} gap="$0.5">
      <Text fontSize="$1" color="$color10">
        {label}
      </Text>
      <Text fontSize="$4" fontWeight="600" color="$color12" className="hz-mono" numberOfLines={1}>
        {value}
      </Text>
    </YStack>
  )
}

/** A spend meter — track fills to `pct` (clamped 0–100), colored by verdict. */
function Meter({ pct, color }: { pct: number; color: string }) {
  const v = Math.max(0, Math.min(100, pct))
  return (
    <YStack height={10} rounded="$3" bg="$color4" width="100%" overflow="hidden">
      <div aria-hidden style={{ height: '100%', width: `${v}%`, background: color, borderRadius: 6 }} />
    </YStack>
  )
}

/** Verdict pill (On track / Warning / Over cap / Unlimited). */
function VerdictTag({ verdict }: { verdict: CapVerdict }) {
  return (
    <XStack items="center" gap="$1.5" px="$2" py="$1" rounded="$3" bg="$color3">
      <span
        aria-hidden
        style={{ width: 7, height: 7, borderRadius: 9999, background: meterColor(verdict), display: 'inline-block' }}
      />
      <Text fontSize="$1" color="$color11" fontWeight="500">
        {VERDICT_LABEL[verdict]}
      </Text>
    </XStack>
  )
}

/** Enforcement-mode pill: hard cap vs alert only. */
function ModeTag({ enforce }: { enforce: boolean }) {
  return (
    <XStack items="center" gap="$1.5" px="$2" py="$1" rounded="$3" bg="$color3">
      {enforce ? <ShieldCheck size={12} /> : <TriangleAlert size={12} opacity={0.7} />}
      <Text fontSize="$1" color="$color11" fontWeight="500">
        {enforce ? 'Hard cap' : 'Alert only'}
      </Text>
    </XStack>
  )
}

// ══ PROMO TAB ══════════════════════════════════════════════════════════════════

function PromoTab() {
  const [state, setState] = useState<Async<PlatformPromo>>({ phase: 'loading' })
  const [form, setForm] = useState<PromoForm | null>(null)
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(() => {
    setState({ phase: 'loading' })
    setNote(null)
    setErr(null)
    AdminPromosApi.get()
      .then((p) => {
        setState({ phase: 'ready', data: p })
        setForm(formForPromo(p))
      })
      .catch((e) => setState({ phase: 'error', err: asApiError(e) }))
  }, [])
  useEffect(() => load(), [load])

  const save = async () => {
    if (!form) return
    const v = validatePromoForm(form)
    if (!v.ok) {
      setErr(v.error)
      return
    }
    setSaving(true)
    setErr(null)
    setNote(null)
    try {
      const saved = await AdminPromosApi.put(v.body)
      setState({ phase: 'ready', data: saved })
      setForm(formForPromo(saved))
      setNote('Promo saved.')
    } catch (e) {
      const a = asApiError(e)
      setErr(isForbidden(a) ? 'SuperAdmin required.' : a.message)
    } finally {
      setSaving(false)
    }
  }

  if (state.phase === 'loading') return <Loading label="Loading the platform promo…" />
  if (state.phase === 'error')
    return isForbidden(state.err) ? <OperatorAccessRequired /> : <ErrorState err={state.err} onRetry={load} />
  if (!form) return null

  const live = state.data
  return (
    <YStack gap="$4">
      <Panel title="Current promo" grow={false} actions={<Button size="$2" icon={<RefreshCw size={15} />} onPress={load} />}>
        <XStack gap="$5" flexWrap="wrap">
          <Fact label="State" value={promoSummary(live)} />
          <Fact label="Percent off" value={`${live.percentOff}%`} />
          <Fact label="Applies to" value={live.plans.length ? live.plans.join(', ') : 'All paid plans'} />
          <Fact label="Window" value={live.start || live.end ? `${live.start || '—'} → ${live.end || '—'}` : 'Always'} />
        </XStack>
      </Panel>

      <Panel title="Edit promo" grow={false}>
        <YStack gap="$3">
          <FieldRow label="Percent off">
            <FieldSlider
              value={form.percentOff}
              min={0}
              max={100}
              step={1}
              onChange={(v) => setForm({ ...form, percentOff: v })}
              disabled={saving}
            />
          </FieldRow>
          <FieldRow label="Start (UTC)">
            <input
              type="datetime-local"
              value={form.start}
              onChange={(e) => setForm({ ...form, start: e.currentTarget.value })}
              disabled={saving}
              style={dtStyle(saving)}
            />
          </FieldRow>
          <FieldRow label="End (UTC)">
            <input
              type="datetime-local"
              value={form.end}
              onChange={(e) => setForm({ ...form, end: e.currentTarget.value })}
              disabled={saving}
              style={dtStyle(saving)}
            />
          </FieldRow>
          <FieldRow label="Plans">
            <YStack gap="$1.5">
              <FieldText
                value={form.plans}
                onChange={(v) => setForm({ ...form, plans: v })}
                placeholder="pro, team  (leave empty = all paid plans)"
                disabled={saving}
              />
              <Text fontSize="$1" color="$color10">
                Comma-separated paid plan ids. Empty = every paid plan.
              </Text>
            </YStack>
          </FieldRow>
          <FieldRow label="Active">
            <FieldSwitch checked={form.active} onChange={(v) => setForm({ ...form, active: v })} disabled={saving} />
          </FieldRow>
          {err ? <Note message={err} tone="error" /> : null}
          {note ? <Note message={note} /> : null}
          <XStack>
            <PrimaryButton icon={Check} onPress={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save promo'}
            </PrimaryButton>
          </XStack>
        </YStack>
      </Panel>
    </YStack>
  )
}

const dtStyle = (disabled?: boolean): React.CSSProperties => ({
  width: '100%',
  boxSizing: 'border-box',
  background: 'var(--background)',
  color: 'var(--color12)',
  border: '1px solid var(--borderColor)',
  borderRadius: 9,
  padding: '9px 12px',
  fontSize: 14,
  height: 40,
  fontFamily: 'inherit',
  outline: 'none',
  opacity: disabled ? 0.5 : 1,
})

// ══ CAPS TAB ═══════════════════════════════════════════════════════════════════

const SCOPE_LABELS: Record<ScopeType, string> = { org: 'Organization-wide', project: 'Project', service: 'Service' }
const SCOPE_OPTIONS = [SCOPE_LABELS.org, SCOPE_LABELS.project, SCOPE_LABELS.service]
const scopeTypeFromLabel = (label: string): ScopeType =>
  label === SCOPE_LABELS.project ? 'project' : label === SCOPE_LABELS.service ? 'service' : 'org'

const EMPTY_CAP_FORM: BudgetForm = {
  title: '',
  scopeType: 'org',
  scopeId: '',
  cap: '',
  softPct: '80',
  rateLimitRpm: '',
  enforce: false,
}

/** The shared cap editor — used by the add form and each card's inline edit. */
function CapFields({ form, setForm, disabled }: { form: BudgetForm; setForm: (f: BudgetForm) => void; disabled?: boolean }) {
  return (
    <YStack gap="$3">
      <FieldRow label="Name">
        <FieldText value={form.title} onChange={(v) => setForm({ ...form, title: v })} placeholder="Monthly cap" disabled={disabled} />
      </FieldRow>
      <FieldRow label="Scope">
        <FieldSelect
          value={SCOPE_LABELS[form.scopeType]}
          options={SCOPE_OPTIONS}
          onChange={(l) => setForm({ ...form, scopeType: scopeTypeFromLabel(l) })}
          disabled={disabled}
        />
      </FieldRow>
      {form.scopeType !== 'org' ? (
        <FieldRow label={`${SCOPE_LABELS[form.scopeType]} id`}>
          <FieldText
            value={form.scopeId}
            onChange={(v) => setForm({ ...form, scopeId: v })}
            placeholder={form.scopeType === 'project' ? 'acme-prod' : 'inference'}
            disabled={disabled}
          />
        </FieldRow>
      ) : null}
      <FieldRow label="Spend cap ($)">
        <FieldText value={form.cap} onChange={(v) => setForm({ ...form, cap: v })} placeholder="500.00  (0 = unlimited)" disabled={disabled} />
      </FieldRow>
      <FieldRow label="Soft-warn (%)">
        <FieldText value={form.softPct} onChange={(v) => setForm({ ...form, softPct: v })} placeholder="80" disabled={disabled} />
      </FieldRow>
      <FieldRow label="Rate limit (req/min)">
        <FieldText value={form.rateLimitRpm} onChange={(v) => setForm({ ...form, rateLimitRpm: v })} placeholder="0 = no limit" disabled={disabled} />
      </FieldRow>
      <FieldRow label="Enforce (hard cap)">
        <XStack items="center" gap="$3">
          <FieldSwitch checked={form.enforce} onChange={(v) => setForm({ ...form, enforce: v })} disabled={disabled} />
          <Text fontSize="$1" color="$color10">
            On = block billable calls once spend hits the cap. Off = alert only.
          </Text>
        </XStack>
      </FieldRow>
    </YStack>
  )
}

function CapCard({ org, cap, onChanged }: { org: string; cap: AdminSpendCap; onChanged: () => void }) {
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<BudgetForm>(() => formForAlert(cap))
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const verdict = capVerdict(cap)
  const pct = spendPct(cap)
  const label = scopeLabel(cap.project, cap.service)

  const beginEdit = () => {
    setForm(formForAlert(cap))
    setError(null)
    setEditing(true)
  }

  const save = async () => {
    const v = validateBudgetForm(form)
    if (!v.ok) {
      setError(v.error)
      return
    }
    setSaving(true)
    setError(null)
    try {
      await AdminSpendCapsApi.update(org, cap.id, {
        title: v.title,
        thresholdCents: v.thresholdCents,
        project: v.project,
        service: v.service,
        enforce: v.enforce,
        softPct: v.softPct,
        rateLimitRpm: v.rateLimitRpm,
      })
      setEditing(false)
      onChanged()
    } catch (e) {
      const a = asApiError(e)
      setError(isForbidden(a) ? 'SuperAdmin required.' : a.message || 'Could not save the cap.')
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (typeof window !== 'undefined' && !window.confirm(`Remove the cap "${cap.title}" (${label}) on ${org}?`)) return
    setRemoving(true)
    setError(null)
    try {
      await AdminSpendCapsApi.remove(org, cap.id)
      onChanged()
    } catch (e) {
      const a = asApiError(e)
      setError(isForbidden(a) ? 'SuperAdmin required.' : a.message || 'Could not remove the cap.')
      setRemoving(false)
    }
  }

  return (
    <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor">
      <XStack items="center" justify="space-between" gap="$3" flexWrap="wrap">
        <XStack items="center" gap="$2" flex={1} minW={180} flexWrap="wrap">
          {isOrgDefault(cap.project, cap.service) ? <Building2 size={15} opacity={0.6} /> : <FolderGit2 size={15} opacity={0.6} />}
          <YStack minW={120}>
            <Text fontSize="$4" fontWeight="700" color="$color12" numberOfLines={1}>
              {cap.title}
            </Text>
            <Text fontSize="$1" color="$color10" numberOfLines={1}>
              {label}
              {cap.userId ? ` · ${cap.userId}` : ''}
            </Text>
          </YStack>
          <VerdictTag verdict={verdict} />
          <ModeTag enforce={cap.enforce} />
        </XStack>
        {!editing ? (
          <XStack gap="$2">
            <Button size="$2" onPress={beginEdit} disabled={removing}>
              Edit
            </Button>
            <Button
              size="$2"
              chromeless
              aria-label={`Remove cap ${cap.title}`}
              icon={<Trash2 size={15} />}
              onPress={remove}
              disabled={removing}
            />
          </XStack>
        ) : null}
      </XStack>

      <YStack gap="$1.5">
        <Meter pct={pct ?? 0} color={meterColor(verdict)} />
        <XStack justify="space-between" gap="$2" flexWrap="wrap">
          <Text fontSize="$2" color="$color11" className="hz-mono">
            {fmtUsd(cap.periodSpentCents)} spent
          </Text>
          <Text fontSize="$2" color="$color10" className="hz-mono">
            {cap.thresholdCents > 0
              ? `of ${fmtUsd(cap.thresholdCents)} cap${pct !== null ? ` · ${Math.round(pct)}%` : ''}`
              : 'Unlimited spend'}
          </Text>
        </XStack>
      </YStack>

      {editing ? (
        <YStack gap="$3" pt="$1">
          <CapFields form={form} setForm={setForm} disabled={saving} />
          {error ? <Note message={error} tone="error" /> : null}
          <XStack gap="$2">
            <PrimaryButton icon={Check} onPress={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save cap'}
            </PrimaryButton>
            <Button
              size="$3"
              chromeless
              onPress={() => {
                setEditing(false)
                setError(null)
              }}
              disabled={saving}
            >
              Cancel
            </Button>
          </XStack>
        </YStack>
      ) : (
        <>
          <XStack gap="$5" flexWrap="wrap" pt="$1">
            <Fact label="Spend cap" value={cap.thresholdCents > 0 ? fmtUsd(cap.thresholdCents) : 'Unlimited'} />
            <Fact label="Soft-warn at" value={cap.softPct > 0 ? `${cap.softPct}%` : '—'} />
            <Fact label="Rate limit" value={cap.rateLimitRpm > 0 ? `${fmtInt(cap.rateLimitRpm)} req/min` : 'No limit'} />
            <Fact label="Period" value={cap.period || '—'} />
            <Fact label="Resets" value={cap.resetsAt || '—'} />
          </XStack>
          {error ? <Note message={error} tone="error" /> : null}
        </>
      )}
    </Card>
  )
}

function AddCapForm({ org, onDone, onCancel }: { org: string; onDone: () => void; onCancel: () => void }) {
  const [form, setForm] = useState<BudgetForm>(EMPTY_CAP_FORM)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    const v = validateBudgetForm(form)
    if (!v.ok) {
      setError(v.error)
      return
    }
    setSaving(true)
    setError(null)
    try {
      await AdminSpendCapsApi.create(org, {
        title: v.title,
        thresholdCents: v.thresholdCents,
        project: v.project,
        service: v.service,
        enforce: v.enforce,
        softPct: v.softPct,
        rateLimitRpm: v.rateLimitRpm,
      })
      onDone()
    } catch (e) {
      const a = asApiError(e)
      setError(isForbidden(a) ? 'SuperAdmin required.' : a.message || 'Could not create the cap.')
      setSaving(false)
    }
  }

  return (
    <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor">
      <Text fontSize="$5" fontWeight="800" color="$color12">
        New cap for {org}
      </Text>
      <Text fontSize="$2" color="$color11">
        Set a spend cap and rate limit for the whole org, one project, or one service. Turn on “Enforce” to hard-stop billable
        calls at the cap; leave it off for an alert-only budget.
      </Text>
      <CapFields form={form} setForm={setForm} disabled={saving} />
      {error ? <Note message={error} tone="error" /> : null}
      <XStack gap="$2">
        <PrimaryButton icon={Plus} onPress={save} disabled={saving}>
          {saving ? 'Saving…' : 'Create cap'}
        </PrimaryButton>
        <Button size="$3" chromeless onPress={onCancel} disabled={saving}>
          Cancel
        </Button>
      </XStack>
    </Card>
  )
}

function CapsTab() {
  const [orgInput, setOrgInput] = useState('')
  const [org, setOrg] = useState('')
  const [state, setState] = useState<Async<AdminSpendCap[]> | null>(null)
  const [adding, setAdding] = useState(false)

  const load = useCallback((slug: string) => {
    const s = slug.trim()
    if (!s) return
    setOrg(s)
    setAdding(false)
    setState({ phase: 'loading' })
    AdminSpendCapsApi.list(s)
      .then((data) => setState({ phase: 'ready', data }))
      .catch((e) => setState({ phase: 'error', err: asApiError(e) }))
  }, [])

  const reload = useCallback(() => {
    if (org) load(org)
  }, [org, load])

  const caps = state?.phase === 'ready' ? state.data : []
  const summary = deriveBudgetsSummary(caps)

  return (
    <YStack gap="$4">
      <Panel title="Target organization" grow={false}>
        <XStack gap="$3" items="flex-end" flexWrap="wrap">
          <YStack gap="$1.5" flex={1} minW={220}>
            <Text fontSize="$2" color="$color11">
              Org slug
            </Text>
            <FieldText value={orgInput} onChange={setOrgInput} placeholder="e.g. maxpower" />
          </YStack>
          <PrimaryButton icon={SlidersHorizontal} onPress={() => load(orgInput)} disabled={orgInput.trim() === ''}>
            Load caps
          </PrimaryButton>
          {org ? (
            <Button size="$3" icon={<RefreshCw size={15} />} onPress={reload}>
              Refresh
            </Button>
          ) : null}
        </XStack>
      </Panel>

      {state === null ? (
        <EmptyState
          icon={SlidersHorizontal}
          title="Pick an organization"
          description="Enter an org slug above to see and override its usage caps — spend limits, hard-cap enforcement, rate limits, and how much of the current period each has spent."
        />
      ) : state.phase === 'loading' ? (
        <Loading label={`Loading caps for ${org}…`} />
      ) : state.phase === 'error' ? (
        isForbidden(state.err) ? (
          <OperatorAccessRequired />
        ) : (
          <ErrorState err={state.err} onRetry={reload} />
        )
      ) : (
        <YStack gap="$4">
          <XStack gap="$3" flexWrap="wrap">
            <MetricCard icon={<SlidersHorizontal size={16} />} label="Caps" value={fmtInt(summary.budgets)} />
            <MetricCard icon={<ShieldCheck size={16} />} label="Hard caps" value={fmtInt(summary.enforced)} />
            <MetricCard icon={<TriangleAlert size={16} />} label="Warnings" value={fmtInt(summary.warning)} />
            <MetricCard icon={<Ban size={16} />} label="Over cap" value={fmtInt(summary.over)} />
            <MetricCard icon={<CircleDollarSign size={16} />} label="Spent this period" value={fmtUsd(summary.totalSpentCents)} />
          </XStack>

          <XStack justify="flex-end">
            <PrimaryButton icon={Plus} onPress={() => setAdding((v) => !v)}>
              New cap
            </PrimaryButton>
          </XStack>

          {adding ? (
            <AddCapForm
              org={org}
              onDone={() => {
                setAdding(false)
                reload()
              }}
              onCancel={() => setAdding(false)}
            />
          ) : null}

          {caps.length === 0 ? (
            adding ? null : (
              <EmptyState
                icon={SlidersHorizontal}
                title={`No caps for ${org}`}
                description="This organization has no usage caps yet. Create one to cap its spend, warn before the cap, or rate-limit its requests."
                primary={{ label: 'Create a cap', onPress: () => setAdding(true) }}
              />
            )
          ) : (
            <YStack gap="$3">
              {caps.map((c) => (
                <CapCard key={c.id} org={org} cap={c} onChanged={reload} />
              ))}
            </YStack>
          )}
        </YStack>
      )}
    </YStack>
  )
}

// ══ MODULE ═════════════════════════════════════════════════════════════════════

type Tab = 'promo' | 'caps'

export function UsageCapsPromoModule() {
  const isAdmin = useIsSuperAdmin()
  const [tab, setTab] = useState<Tab>('promo')

  if (!isAdmin) return <OperatorAccessRequired />

  return (
    <YStack p="$4" gap="$5">
      <PageHeader
        title="Usage Caps & Promo"
        subtitle="Set the platform plan promo, and oversee or override any organization's usage caps."
      />

      <XStack gap="$2" self="flex-start" p="$1" rounded="$5" bg="$color3">
        <Button size="$3" theme={tab === 'promo' ? 'light' : undefined} icon={<Gift size={15} />} onPress={() => setTab('promo')}>
          Promo
        </Button>
        <Button
          size="$3"
          theme={tab === 'caps' ? 'light' : undefined}
          icon={<SlidersHorizontal size={15} />}
          onPress={() => setTab('caps')}
        >
          Caps
        </Button>
      </XStack>

      {tab === 'promo' ? <PromoTab /> : <CapsTab />}
    </YStack>
  )
}
