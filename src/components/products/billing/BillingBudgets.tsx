'use client'

/**
 * Budgets & limits — view and set per-scope SPEND CAPS and RATE LIMITS over the REAL
 * commerce alerts API (`GET/POST/PATCH/DELETE /v1/billing/alerts`, the
 * user-group endpoints billing.hanzo.ai itself uses), scoped to the caller's OWN
 * subject by the `/billing` proxy (server-pinned — a caller only ever sees/edits their
 * own budgets).
 *
 * This is a REAL working surface, not a stub: a budget you set here is persisted by
 * commerce; a HARD cap (`enforce`) blocks billable calls at the cap (402), a rate limit
 * throttles them (429), and a soft budget just warns. Each scope shows its live period
 * spend against its cap as a meter that turns amber at the soft-warn threshold (`warn`)
 * and red when over (`over`) — straight from the backend's own verdict, never
 * fabricated. Forward-compatible: a legacy soft-alert row (no scope/enforce/spend
 * fields yet) renders as an org-wide alert and the meter/enforce/rate-limit surface
 * lights up the moment the backend emits them. Honest states throughout: skeleton
 * loading, a truthful `BackendStateCard` on failure, and a rich empty. Refetch-after-
 * save (the console convention). Mobile-first: the tiles, cards, and forms reflow with
 * `flexWrap` — no horizontal body scroll.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Input, Text, XStack, YStack } from '@hanzo/gui'
import {
  Ban,
  Building2,
  Check,
  CircleDollarSign,
  FolderGit2,
  Plus,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  TriangleAlert,
} from '@hanzogui/lucide-icons-2'

import { BillingApi, type SpendAlert } from '~/lib/api/billing'
import { fmtInt, fmtUsd } from '~/lib/api/functions'
import { PageHeader } from '~/components/ui/PageHeader'
import { EmptyState } from '~/components/ui/EmptyState'
import { MetricCard } from '~/components/ui/Metric'
import { FieldSelect, FieldSwitch } from '~/components/ui/Field'
import { BackendStateCard, classifyBackend, type BackendState } from '~/components/ui/BackendState'
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
  type BudgetsSummary,
  type CapVerdict,
  type ScopeType,
} from './budgets-logic'

type Async<T> = { phase: 'loading' } | { phase: 'error'; error: BackendState } | { phase: 'ready'; data: T }

const SCOPE_LABELS: Record<ScopeType, string> = {
  org: 'Organization-wide',
  project: 'Project',
  service: 'Service',
}
const SCOPE_OPTIONS = [SCOPE_LABELS.org, SCOPE_LABELS.project, SCOPE_LABELS.service]
const scopeTypeFromLabel = (label: string): ScopeType =>
  label === SCOPE_LABELS.project ? 'project' : label === SCOPE_LABELS.service ? 'service' : 'org'

// ── Small presentational primitives ───────────────────────────────────────────

/** A responsive spend meter — track fills to `pct` (clamped 0–100), colored by verdict. */
function Meter({ pct, color }: { pct: number; color: string }) {
  const v = Math.max(0, Math.min(100, pct))
  return (
    <YStack height={10} rounded="$3" bg="$color4" width="100%" overflow="hidden">
      <div aria-hidden style={{ height: '100%', width: `${v}%`, background: color, borderRadius: 6 }} />
    </YStack>
  )
}

/** A budget-verdict pill: colored dot + label (On track / Warning / Over cap / Unlimited). */
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

/** Enforcement mode pill: hard cap (enforced) vs soft alert. */
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

/** A labeled read-only fact (Spend cap / Soft-warn / Rate limit / Mode). */
function Fact({ label, value }: { label: string; value: string }) {
  return (
    <YStack minW={110} gap="$0.5">
      <Text fontSize="$1" color="$color10">
        {label}
      </Text>
      <Text fontSize="$4" fontWeight="600" color="$color12" className="hz-mono">
        {value}
      </Text>
    </YStack>
  )
}

/** A labeled numeric input with an optional currency prefix / unit suffix + hint. */
function NumField({
  label,
  prefix,
  suffix,
  hint,
  value,
  onChange,
  placeholder,
  disabled,
}: {
  label: string
  prefix?: string
  suffix?: string
  hint?: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  disabled?: boolean
}) {
  return (
    <YStack gap="$1.5" flex={1} minW={150}>
      <Text fontSize="$2" color="$color11">
        {label}
      </Text>
      <XStack items="center" gap="$2">
        {prefix ? (
          <Text fontSize="$5" color="$color11">
            {prefix}
          </Text>
        ) : null}
        <Input
          flex={1}
          value={value}
          onChangeText={onChange}
          placeholder={placeholder}
          disabled={disabled}
          keyboardType="decimal-pad"
          autoCapitalize="none"
        />
        {suffix ? (
          <Text fontSize="$2" color="$color10">
            {suffix}
          </Text>
        ) : null}
      </XStack>
      {hint ? (
        <Text fontSize="$1" color="$color10">
          {hint}
        </Text>
      ) : null}
    </YStack>
  )
}

/** A labeled text input (a title, or the project/service scope id). */
function TextField({
  label,
  value,
  onChange,
  placeholder,
  disabled,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  disabled?: boolean
}) {
  return (
    <YStack gap="$1.5" flex={1} minW={150}>
      <Text fontSize="$2" color="$color11">
        {label}
      </Text>
      <Input value={value} onChangeText={onChange} placeholder={placeholder} disabled={disabled} autoCapitalize="none" />
    </YStack>
  )
}

/** An inline error line (icon + message). */
function ErrorLine({ message }: { message: string }) {
  return (
    <XStack items="center" gap="$2">
      <TriangleAlert size={14} />
      <Text fontSize="$2" color="$color11">
        {message}
      </Text>
    </XStack>
  )
}

/** The full budget editor — shared by the add form and each card's inline edit. */
function BudgetFields({
  form,
  setForm,
  disabled,
}: {
  form: BudgetForm
  setForm: (f: BudgetForm) => void
  disabled?: boolean
}) {
  return (
    <YStack gap="$3">
      <XStack gap="$3" flexWrap="wrap">
        <TextField
          label="Name"
          value={form.title}
          onChange={(v) => setForm({ ...form, title: v })}
          placeholder="e.g. Monthly cap"
          disabled={disabled}
        />
        <YStack gap="$1.5" flex={1} minW={150}>
          <Text fontSize="$2" color="$color11">
            Scope
          </Text>
          <FieldSelect
            value={SCOPE_LABELS[form.scopeType]}
            options={SCOPE_OPTIONS}
            onChange={(label) => setForm({ ...form, scopeType: scopeTypeFromLabel(label) })}
            disabled={disabled}
          />
        </YStack>
        {form.scopeType !== 'org' ? (
          <TextField
            label={`${SCOPE_LABELS[form.scopeType]} id`}
            value={form.scopeId}
            onChange={(v) => setForm({ ...form, scopeId: v })}
            placeholder={form.scopeType === 'project' ? 'e.g. acme-prod' : 'e.g. inference'}
            disabled={disabled}
          />
        ) : null}
      </XStack>
      <XStack gap="$3" flexWrap="wrap">
        <NumField
          label="Spend cap"
          prefix="$"
          hint="0 = unlimited"
          value={form.cap}
          onChange={(v) => setForm({ ...form, cap: v })}
          placeholder="500.00"
          disabled={disabled}
        />
        <NumField
          label="Soft-warn at"
          suffix="%"
          hint="0–100"
          value={form.softPct}
          onChange={(v) => setForm({ ...form, softPct: v })}
          placeholder="80"
          disabled={disabled}
        />
        <NumField
          label="Rate limit"
          suffix="req/min"
          hint="0 = no limit"
          value={form.rateLimitRpm}
          onChange={(v) => setForm({ ...form, rateLimitRpm: v })}
          placeholder="600"
          disabled={disabled}
        />
      </XStack>
      <XStack items="center" gap="$3" flexWrap="wrap">
        <FieldSwitch checked={form.enforce} onChange={(v) => setForm({ ...form, enforce: v })} disabled={disabled} />
        <YStack>
          <Text fontSize="$2" color="$color12" fontWeight="600">
            Enforce (hard cap)
          </Text>
          <Text fontSize="$1" color="$color10">
            On = block billable calls once spend hits the cap. Off = alert only.
          </Text>
        </YStack>
      </XStack>
    </YStack>
  )
}

// ── Summary band ───────────────────────────────────────────────────────────────

function SummaryBand({ summary }: { summary: BudgetsSummary }) {
  return (
    <XStack gap="$3" flexWrap="wrap">
      <MetricCard icon={<SlidersHorizontal size={16} />} label="Budgets" value={fmtInt(summary.budgets)} />
      <MetricCard icon={<ShieldCheck size={16} />} label="Hard caps" value={fmtInt(summary.enforced)} />
      <MetricCard icon={<TriangleAlert size={16} />} label="Warnings" value={fmtInt(summary.warning)} />
      <MetricCard icon={<Ban size={16} />} label="Over cap" value={fmtInt(summary.over)} />
      <MetricCard icon={<CircleDollarSign size={16} />} label="Spent this period" value={fmtUsd(summary.totalSpentCents)} />
    </XStack>
  )
}

// ── One budget card (view + inline edit + remove) ──────────────────────────────

function BudgetCard({ alert, onChanged }: { alert: SpendAlert; onChanged: () => void }) {
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState<BudgetForm>(() => formForAlert(alert))
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const verdict = capVerdict(alert)
  const pct = spendPct(alert)
  const label = scopeLabel(alert.project, alert.service)

  const beginEdit = () => {
    setForm(formForAlert(alert))
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
      await BillingApi.updateSpendAlert(alert.id, {
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
      setError(e instanceof Error ? e.message : 'Could not save the budget.')
    } finally {
      setSaving(false)
    }
  }

  const remove = async () => {
    if (typeof window !== 'undefined' && !window.confirm(`Remove the budget "${alert.title}" (${label})?`)) return
    setRemoving(true)
    setError(null)
    try {
      await BillingApi.deleteSpendAlert(alert.id)
      onChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove the budget.')
      setRemoving(false)
    }
  }

  return (
    <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor">
      {/* Header — name + scope + verdict + mode, with edit/remove (wraps on mobile). */}
      <XStack items="center" justify="space-between" gap="$3" flexWrap="wrap">
        <XStack items="center" gap="$2" flex={1} minW={180} flexWrap="wrap">
          {isOrgDefault(alert.project, alert.service) ? (
            <Building2 size={15} opacity={0.6} />
          ) : (
            <FolderGit2 size={15} opacity={0.6} />
          )}
          <YStack minW={120}>
            <Text fontSize="$4" fontWeight="700" color="$color12" numberOfLines={1}>
              {alert.title}
            </Text>
            <Text fontSize="$1" color="$color10" numberOfLines={1}>
              {label}
            </Text>
          </YStack>
          <VerdictTag verdict={verdict} />
          <ModeTag enforce={alert.enforce} />
        </XStack>
        {!editing ? (
          <XStack gap="$2">
            <Button size="$2" onPress={beginEdit} disabled={removing}>
              Edit
            </Button>
            <Button
              size="$2"
              chromeless
              aria-label={`Remove budget ${alert.title}`}
              icon={<Trash2 size={15} />}
              onPress={remove}
              disabled={removing}
            />
          </XStack>
        ) : null}
      </XStack>

      {/* Spend meter — spent vs cap, colored by verdict; honest "Unlimited" when no cap. */}
      <YStack gap="$1.5">
        <Meter pct={pct ?? 0} color={meterColor(verdict)} />
        <XStack justify="space-between" gap="$2" flexWrap="wrap">
          <Text fontSize="$2" color="$color11" className="hz-mono">
            {fmtUsd(alert.periodSpentCents)} spent
          </Text>
          <Text fontSize="$2" color="$color10" className="hz-mono">
            {alert.thresholdCents > 0
              ? `of ${fmtUsd(alert.thresholdCents)} cap${pct !== null ? ` · ${Math.round(pct)}%` : ''}`
              : 'Unlimited spend'}
          </Text>
        </XStack>
      </YStack>

      {/* Facts (view) or the editor (edit). */}
      {editing ? (
        <YStack gap="$3" pt="$1">
          <BudgetFields form={form} setForm={setForm} disabled={saving} />
          {error ? <ErrorLine message={error} /> : null}
          <XStack gap="$2">
            <Button size="$3" theme="light" icon={<Check size={15} />} onPress={save} disabled={saving}>
              {saving ? 'Saving…' : 'Save budget'}
            </Button>
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
            <Fact label="Spend cap" value={alert.thresholdCents > 0 ? fmtUsd(alert.thresholdCents) : 'Unlimited'} />
            <Fact label="Soft-warn at" value={alert.softPct > 0 ? `${alert.softPct}%` : '—'} />
            <Fact label="Rate limit" value={alert.rateLimitRpm > 0 ? `${fmtInt(alert.rateLimitRpm)} req/min` : 'No limit'} />
            <Fact label="Mode" value={alert.enforce ? 'Hard cap' : 'Alert only'} />
          </XStack>
          {error ? <ErrorLine message={error} /> : null}
        </>
      )}
    </Card>
  )
}

// ── Add form ───────────────────────────────────────────────────────────────────

const EMPTY_FORM: BudgetForm = {
  title: '',
  scopeType: 'org',
  scopeId: '',
  cap: '',
  softPct: '80',
  rateLimitRpm: '',
  enforce: false,
}

function AddBudgetForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [form, setForm] = useState<BudgetForm>(EMPTY_FORM)
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
      await BillingApi.createSpendAlert({
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
      setError(e instanceof Error ? e.message : 'Could not create the budget.')
      setSaving(false)
    }
  }

  return (
    <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor">
      <Text fontSize="$5" fontWeight="800" color="$color12">
        New budget
      </Text>
      <Text fontSize="$2" color="$color11">
        Set a spend cap and rate limit for your whole organization, a single project, or one service. Turn on
        “Enforce” to hard-stop spend at the cap; leave it off for a warning-only budget.
      </Text>
      <BudgetFields form={form} setForm={setForm} disabled={saving} />
      {error ? <ErrorLine message={error} /> : null}
      <XStack gap="$2">
        <Button size="$3" theme="light" icon={<Plus size={15} />} onPress={save} disabled={saving}>
          {saving ? 'Saving…' : 'Create budget'}
        </Button>
        <Button size="$3" chromeless onPress={onCancel} disabled={saving}>
          Cancel
        </Button>
      </XStack>
    </Card>
  )
}

// ── Loading skeleton ────────────────────────────────────────────────────────────

function LoadingCards() {
  return (
    <YStack gap="$3">
      {[0, 1, 2].map((i) => (
        <Card key={i} p="$4" gap="$3" borderWidth={1} borderColor="$borderColor">
          <div className="hz-skeleton" style={{ height: 16, width: '32%', borderRadius: 6 }} aria-hidden />
          <div className="hz-skeleton" style={{ height: 10, width: '100%', borderRadius: 6 }} aria-hidden />
          <div className="hz-skeleton" style={{ height: 12, width: '48%', borderRadius: 6 }} aria-hidden />
        </Card>
      ))}
    </YStack>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

export function BillingBudgets(_props: { params: Record<string, string> }) {
  const [state, setState] = useState<Async<SpendAlert[]>>({ phase: 'loading' })
  const [adding, setAdding] = useState(false)

  const load = useCallback(() => {
    setState({ phase: 'loading' })
    BillingApi.spendAlerts()
      .then((data) => setState({ phase: 'ready', data }))
      .catch((e) => setState({ phase: 'error', error: classifyBackend(e) }))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const alerts = state.phase === 'ready' ? state.data : []
  const summary = deriveBudgetsSummary(alerts)

  return (
    <>
      <PageHeader
        title="Budgets & limits"
        subtitle="Set a spend cap and request rate limit per scope — organization-wide, per project, or per service. A hard cap blocks billable calls at the limit; a soft budget warns. Meters show your real spend this period, read from and saved to commerce."
        actions={
          <XStack gap="$2">
            <Button size="$2" icon={<RefreshCw size={15} />} onPress={load}>
              Refresh
            </Button>
            <Button
              size="$2"
              theme="light"
              icon={<Plus size={14} />}
              onPress={() => setAdding((v) => !v)}
              disabled={state.phase !== 'ready'}
            >
              New budget
            </Button>
          </XStack>
        }
      />

      {state.phase === 'error' ? (
        <BackendStateCard state={state.error} onRetry={load} hint="endpoint · GET /v1/billing/alerts" />
      ) : state.phase === 'loading' ? (
        <LoadingCards />
      ) : (
        <YStack gap="$4">
          <SummaryBand summary={summary} />

          {adding ? (
            <AddBudgetForm
              onDone={() => {
                setAdding(false)
                load()
              }}
              onCancel={() => setAdding(false)}
            />
          ) : null}

          {alerts.length === 0 ? (
            adding ? null : (
              <EmptyState
                icon={SlidersHorizontal}
                title="No budgets yet"
                description="Set a budget to cap spend and rate-limit requests before they run away — for your whole organization, a single project, or one service."
                bullets={[
                  'A spend cap ($) warns (or hard-stops, if enforced) once the period total reaches it.',
                  'A soft-warn threshold (%) flags a budget before it hits the cap.',
                  'A rate limit (requests/minute) caps burst usage.',
                ]}
                primary={{ label: 'Create a budget', onPress: () => setAdding(true) }}
              />
            )
          ) : (
            <YStack gap="$3">
              {alerts.map((a) => (
                <BudgetCard key={a.id} alert={a} onChanged={load} />
              ))}
            </YStack>
          )}
        </YStack>
      )}
    </>
  )
}
