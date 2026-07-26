'use client'

/**
 * Router policy editor — the per-org λ/µ controls (the Router product's "Policy"
 * tab). This is the ONE org-router config surface; `RouterModule` embeds it as a
 * sub-section (never a second copy). The auto-routing ON/OFF preference is a
 * SEPARATE concern that lives on the Smart-routing surface (`ai-accounts`) — it is
 * not duplicated here.
 *
 * One form, four concerns, all org-scoped and customer-writable, round-tripped
 * through GET/POST /v1/{get,update}-router-policy:
 *   Enabled models — the allowlist the router may pick from (multi-select over the
 *                    org's servable `available` set). Empty selection = ALL allowed.
 *   Savings ↔ quality — the dial (0..1): 0 = cheapest capable model, 1 = best
 *                    model, 0.5 = balanced. Unset renders balanced (0.5).
 *   Prefer — the task -> ordered model-id table ("default" is the catch-all). An
 *            org customizing one task keeps the conf defaults for the rest (the
 *            server folds org > "*" > conf per task key). Comma-separated ids.
 *   Cost ceiling — a per-1k cost cap the learned path enforces as a hard gate
 *                  (arms above it drop). 0 = no cap.
 *
 * Saving an empty prefer + 0 ceiling + empty allowlist CLEARS the org override
 * (reverts to "*" then conf) — the honest "reset to platform default". The endpoint
 * is org-admin gated server-side and self-scoped to the caller's org, so a customer
 * configures only their own router. Honest states: loading, error (BackendStateCard
 * + retry), and the resolved effective policy (never a fabricated default).
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { Route, Save, RotateCcw, Gauge, ListChecks, Check } from '@hanzogui/lucide-icons-2'

import { RouterPolicyApi, type RouterPolicy, type RouterModel } from '~/lib/api/router'
import { PageHeader } from '~/components/ui/PageHeader'
import { PrimaryButton } from '~/components/ui/PrimaryButton'
import { BackendStateCard, classifyBackend, type BackendState } from '~/components/ui/BackendState'
import { FieldRow, FieldText, FieldSlider } from '~/components/ui/Field'
import { Loader } from '~/components/ui/Loader'
import { useToast } from '~/components/ui/Toast'

type Async<T> = { phase: 'loading' } | { phase: 'error'; error: BackendState } | { phase: 'ready'; data: T }

/** Monochrome router accent — design --neutral-300 (matches RouterModule). */
const ACCENT = 'var(--color11)'

/** The canonical task tags a pool may map (matches the Go router Task set). */
const TASKS = [
  'code',
  'reasoning',
  'math',
  'creative',
  'vision',
  'long_context',
  'cheap_chat',
  'default',
] as const

/** Render a prefer table as the editable form state: task -> comma-joined ids. */
function toForm(prefer: Record<string, string[]>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const t of TASKS) out[t] = (prefer[t] ?? []).join(', ')
  return out
}

/** Parse the form back to a prefer table: split on comma, trim, drop empties. */
function fromForm(form: Record<string, string>): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const t of TASKS) {
    const ids = form[t]
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
    if (ids.length > 0) out[t] = ids
  }
  return out
}

/** Clamp to the dial's 0..1 domain. */
const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n)

/** Snap a raw slider value to a clean 0.05 step in 0..1 (avoids float drift like 0.30000000004). */
const snapBias = (v: number): number => clamp01(Number((Math.round(v / 0.05) * 0.05).toFixed(2)))

/** A human label for the dial position (Savings ↔ Quality). */
function biasLabel(b: number): string {
  if (b <= 0.2) return 'Maximize savings'
  if (b < 0.45) return 'Favor savings'
  if (b <= 0.55) return 'Balanced'
  if (b < 0.8) return 'Favor quality'
  return 'Maximize quality'
}

export function RouterPolicyEditor(_props: { params: Record<string, string> }) {
  const toast = useToast()
  const [state, setState] = useState<Async<RouterPolicy>>({ phase: 'loading' })
  const [form, setForm] = useState<Record<string, string>>(toForm({}))
  const [ceiling, setCeiling] = useState('0')
  const [enabled, setEnabled] = useState<string[]>([])
  const [available, setAvailable] = useState<RouterModel[]>([])
  const [bias, setBias] = useState(0.5)
  const [busy, setBusy] = useState(false)

  /** Populate every form control from a policy payload (shared by load + save round-trip). */
  const hydrate = useCallback((p: RouterPolicy) => {
    setForm(toForm(p.prefer ?? {}))
    setCeiling(String(p.costCeiling ?? 0))
    setEnabled(Array.isArray(p.enabledModels) ? p.enabledModels : [])
    // null/absent → balanced (0.5); a real number → clamp to 0..1.
    setBias(typeof p.qualityBias === 'number' ? clamp01(p.qualityBias) : 0.5)
    // `available` is a GET-only field — preserve the loaded set if a save response omits it.
    if (Array.isArray(p.available)) setAvailable(p.available)
  }, [])

  const load = useCallback(() => {
    setState({ phase: 'loading' })
    RouterPolicyApi.get()
      .then((p) => {
        setState({ phase: 'ready', data: p })
        hydrate(p)
      })
      .catch((e) => setState({ phase: 'error', error: classifyBackend(e) }))
  }, [hydrate])

  useEffect(() => {
    load()
  }, [load])

  const setTask = (t: string, v: string) => setForm((prev) => ({ ...prev, [t]: v }))

  /** Toggle one model in the allowlist (add if absent, remove if present). */
  const toggleModel = (id: string) =>
    setEnabled((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))

  const save = async () => {
    setBusy(true)
    try {
      const prefer = fromForm(form)
      const costCeiling = Number.parseFloat(ceiling) || 0
      const p = await RouterPolicyApi.save({ prefer, costCeiling, enabledModels: enabled, qualityBias: bias })
      setState({ phase: 'ready', data: p })
      hydrate(p)
      toast.success('Router policy saved')
    } catch (e) {
      toast.error('Could not save router policy', e instanceof Error ? e.message : undefined)
    } finally {
      setBusy(false)
    }
  }

  const reset = () => {
    if (state.phase !== 'ready') return
    setForm(toForm({}))
    setCeiling('0')
    setEnabled([])
    setBias(0.5)
  }

  const hasOverride = state.phase === 'ready' && state.data.hasOverride

  return (
    <>
      <PageHeader
        title="Router policy"
        subtitle="Configure your org's model allowlist, savings↔quality dial, task pools, and cost ceiling — the router folds org > “*” > platform default."
        actions={
          <XStack gap="$2" flexWrap="wrap">
            <Button size="$2" icon={<RotateCcw size={15} />} onPress={reset} disabled={busy}>
              Reset
            </Button>
            <PrimaryButton size="$2" icon={<Save size={15} />} onPress={save} disabled={busy}>
              Save
            </PrimaryButton>
          </XStack>
        }
      />

      {state.phase === 'loading' ? (
        <Loader label="Loading router policy…" />
      ) : state.phase === 'error' ? (
        <BackendStateCard state={state.error} onRetry={load} hint="GET /v1/router/policy" />
      ) : (
        <YStack gap="$4">
          {/* Enabled models — the allowlist the router may pick from. Empty = all allowed. */}
          <Card p="$4" gap="$3.5" borderWidth={1} borderColor="$borderColor">
            <XStack items="center" gap="$2" justify="space-between" flexWrap="wrap">
              <XStack items="center" gap="$2">
                <ListChecks size={18} color={ACCENT} />
                <Text fontSize="$5" fontWeight="700">
                  Enabled models
                </Text>
              </XStack>
              <XStack gap="$2">
                <Button
                  size="$2"
                  onPress={() => setEnabled(available.map((m) => m.id))}
                  disabled={busy || available.length === 0}
                >
                  Select all
                </Button>
                <Button size="$2" onPress={() => setEnabled([])} disabled={busy || enabled.length === 0}>
                  Clear
                </Button>
              </XStack>
            </XStack>
            <Text fontSize="$2" color="$color11" maxW={720}>
              The models the router is allowed to pick from.{' '}
              {enabled.length === 0
                ? 'All models are allowed — an empty selection means no restriction.'
                : `${enabled.length} of ${available.length} models selected.`}
            </Text>
            {available.length === 0 ? (
              <Text fontSize="$2" color="$color10">
                No servable models are reported for your org yet — the router uses the platform default set.
              </Text>
            ) : (
              <XStack gap="$2" flexWrap="wrap">
                {available.map((m) => {
                  const on = enabled.includes(m.id)
                  return (
                    <Button
                      key={m.id}
                      size="$2"
                      onPress={() => toggleModel(m.id)}
                      disabled={busy}
                      bg={on ? '$color5' : 'transparent'}
                      borderWidth={1}
                      borderColor={on ? ACCENT : '$borderColor'}
                      icon={on ? <Check size={14} color={ACCENT} /> : undefined}
                    >
                      {m.name || m.id}
                    </Button>
                  )
                })}
              </XStack>
            )}
          </Card>

          {/* Savings ↔ quality dial (0..1). */}
          <Card p="$4" gap="$3.5" borderWidth={1} borderColor="$borderColor">
            <XStack items="center" gap="$2">
              <Gauge size={18} color={ACCENT} />
              <Text fontSize="$5" fontWeight="700">
                Savings vs quality
              </Text>
            </XStack>
            <Text fontSize="$2" color="$color11" maxW={720}>
              Bias the router between cost and capability: 0 = maximize savings (cheapest capable model),
              1 = maximize quality (best model), 0.5 = balanced.
            </Text>
            <FieldRow label={biasLabel(bias)}>
              <FieldSlider value={bias} min={0} max={1} step={0.05} onChange={(v) => setBias(snapBias(v))} disabled={busy} />
            </FieldRow>
            <XStack justify="space-between" maxW={560}>
              <Text fontSize="$1" color="$color10">
                Savings
              </Text>
              <Text fontSize="$1" color="$color10">
                Balanced
              </Text>
              <Text fontSize="$1" color="$color10">
                Quality
              </Text>
            </XStack>
          </Card>

          {/* Task pools — the task -> ordered model-id table. */}
          <Card p="$4" gap="$3.5" borderWidth={1} borderColor="$borderColor">
            <XStack items="center" gap="$2">
              <Route size={18} color={ACCENT} />
              <Text fontSize="$5" fontWeight="700">
                Task pools
              </Text>
              {hasOverride ? (
                <Text fontSize="$1" color="$color10">
                  Your org overrides the platform default
                </Text>
              ) : (
                <Text fontSize="$1" color="$color10">
                  Showing the effective platform default
                </Text>
              )}
            </XStack>
            <Text fontSize="$2" color="$color11" maxW={720}>
              Each task maps to an ordered model pool; the first servable model wins. Leave a task
              empty to inherit the platform default. Comma-separate model ids (e.g.{' '}
              <Text style={{ fontFamily: 'monospace' }}>zen5-coder, qwen3-coder</Text>).
            </Text>
            {TASKS.map((t) => (
              <FieldRow key={t} label={t}>
                <FieldText value={form[t]} onChange={(v) => setTask(t, v)} disabled={busy} placeholder={t === 'default' ? 'zen5, gpt-4o' : 'inherit default'} />
              </FieldRow>
            ))}
          </Card>

          {/* Cost ceiling — a per-1k-token hard gate. */}
          <Card p="$4" gap="$3.5" borderWidth={1} borderColor="$borderColor">
            <Text fontSize="$5" fontWeight="700">
              Cost ceiling
            </Text>
            <Text fontSize="$2" color="$color11" maxW={720}>
              A per-1k-token cap the router enforces as a hard gate (models above it are dropped).
              0 = no cap. A caller header (<Text style={{ fontFamily: 'monospace' }}>X-Max-Cost</Text>)
              overrides it per request.
            </Text>
            <FieldRow label="Per 1k tokens ($)">
              <FieldText value={ceiling} onChange={setCeiling} disabled={busy} placeholder="0" />
            </FieldRow>
          </Card>
        </YStack>
      )}
    </>
  )
}
