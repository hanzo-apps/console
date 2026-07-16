'use client'

/**
 * Router — the per-org router policy editor (registry `''`, AI category).
 *
 * One form, two concerns, both org-scoped and customer-writable:
 *   Prefer — the task -> ordered model-id table ("default" is the catch-all). An
 *            org customizing one task keeps the conf defaults for the rest (the
 *            server folds org > "*" > conf per task key). Models are comma-separated
 *            so the pool is editable without a per-row picker.
 *   Cost ceiling — a per-1k cost cap the learned path enforces as a hard gate
 *                  (arms above it drop). 0 = no cap.
 *
 * Saving an empty prefer + 0 ceiling CLEARS the org override (reverts to "*" then
 * conf) — the honest "reset to platform default". The endpoint is org-admin gated
 * server-side and self-scoped to the caller's org, so a customer configures only
 * their own router. Honest states: loading, error (BackendStateCard + retry),
 * and the resolved effective table (never a fabricated default).
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { Route, Save, RotateCcw } from '@hanzogui/lucide-icons-2'

import { RouterPolicyApi, type RouterPolicy } from '~/lib/api/router'
import { PageHeader } from '~/components/ui/PageHeader'
import { PrimaryButton } from '~/components/ui/PrimaryButton'
import { BackendStateCard, classifyBackend, type BackendState } from '~/components/ui/BackendState'
import { FieldRow, FieldText } from '~/components/ui/Field'
import { Loader } from '~/components/ui/Loader'
import { useToast } from '~/components/ui/Toast'

type Async<T> = { phase: 'loading' } | { phase: 'error'; error: BackendState } | { phase: 'ready'; data: T }

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

export function RouterModule(_props: { params: Record<string, string> }) {
  const toast = useToast()
  const [state, setState] = useState<Async<RouterPolicy>>({ phase: 'loading' })
  const [form, setForm] = useState<Record<string, string>>(toForm({}))
  const [ceiling, setCeiling] = useState('0')
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    setState({ phase: 'loading' })
    RouterPolicyApi.get()
      .then((p) => {
        setState({ phase: 'ready', data: p })
        setForm(toForm(p.prefer ?? {}))
        setCeiling(String(p.costCeiling ?? 0))
      })
      .catch((e) => setState({ phase: 'error', error: classifyBackend(e) }))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const setTask = (t: string, v: string) => setForm((prev) => ({ ...prev, [t]: v }))

  const save = async () => {
    setBusy(true)
    try {
      const prefer = fromForm(form)
      const costCeiling = Number.parseFloat(ceiling) || 0
      const p = await RouterPolicyApi.save({ prefer, costCeiling })
      setState({ phase: 'ready', data: p })
      setForm(toForm(p.prefer ?? {}))
      setCeiling(String(p.costCeiling ?? 0))
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
  }

  const hasOverride = state.phase === 'ready' && state.data.hasOverride

  return (
    <>
      <PageHeader
        title="Router"
        subtitle="Route each request to the best, cheapest capable model. Configure your org's task pools and cost ceiling."
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
        <BackendStateCard state={state.error} onRetry={load} />
      ) : (
        <YStack gap="$4">
          <Card p="$4" gap="$3.5" borderWidth={1} borderColor="$borderColor">
            <XStack items="center" gap="$2">
              <Route size={18} color="#a371f7" />
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
              <Text style={{ fontFamily: 'monospace' }}>zen4-coder, qwen3-coder</Text>).
            </Text>
            {TASKS.map((t) => (
              <FieldRow key={t} label={t}>
                <FieldText value={form[t]} onChange={(v) => setTask(t, v)} disabled={busy} placeholder={t === 'default' ? 'zen4, gpt-4o' : 'inherit default'} />
              </FieldRow>
            ))}
          </Card>

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

export default RouterModule
