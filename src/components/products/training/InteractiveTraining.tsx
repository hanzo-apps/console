'use client'

/**
 * Interactive Training — the Tinker-style ENGINE surface (live LoRA client). You create
 * a client on a base model, watch it warm to `ready`, then drive it by hand:
 * forward_backward + optim_step a batch (plotting the real loss curve), sample from the
 * current adapter, and export a PEFT adapter. Every row/number is a REAL engine value or
 * an honest state (`—`, a BackendStateCard, an inline error message) — nothing fabricated.
 *
 * Wired to `TrainingApi` (the `/ai/v1/training/*` bearer proxy). The clients list
 * poll-refreshes while any client is still `loading`. Distinct from the Jobs tab, which
 * is the cloud k8s training plane (`TrainApi`).
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Card, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { Play, Plus, RefreshCw, Save, Sparkles, Trash2, X } from '@hanzogui/lucide-icons-2'

import { ApiError } from '~/lib/api'
import {
  TrainingApi,
  DEFAULT_LORA,
  type TrainingClientInfo,
  type TrainingClientDetail,
} from '~/lib/api/training'
import { parseTrainingData } from './interactive-data'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { StatusTag } from '~/components/ui/StatusTag'
import { Panel } from '~/components/ui/Metric'
import { LineChart, type ChartPoint } from '~/components/ui/Charts'
import { BackendStateCard, classifyBackend, type BackendState } from '~/components/ui/BackendState'
import { FieldRow, FieldText, FieldTextArea } from '~/components/ui/Field'
import { toneColor } from '~/components/ui/tone'

type Async<T> = { phase: 'loading' } | { phase: 'error'; error: BackendState } | { phase: 'ready'; data: T }

const POLL_MS = 2500
const ERR = toneColor('critical')
const OK = toneColor('positive')

const fmtInt = (n?: number) => (typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString() : '—')
const fmtLoss = (n?: number) => (typeof n === 'number' && Number.isFinite(n) ? n.toFixed(4) : '—')
const numOr = (s: string, d: number) => (Number.isFinite(Number(s)) && s.trim() !== '' ? Number(s) : d)
const msg = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback)

const SAMPLE_JSONL = '{"prompt": "2 + 2 =", "completion": " 4"}\n{"prompt": "The capital of France is", "completion": " Paris"}'

// ── New client ───────────────────────────────────────────────────────────────────────

function NewClientForm({ onCreated, onClose }: { onCreated: (c: TrainingClientInfo) => void; onClose: () => void }) {
  const [baseModel, setBaseModel] = useState('')
  const [rank, setRank] = useState(String(DEFAULT_LORA.rank))
  const [alpha, setAlpha] = useState(String(DEFAULT_LORA.alpha))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const canCreate = baseModel.trim().length > 0 && !busy

  const create = async () => {
    setBusy(true)
    setError(null)
    try {
      const c = await TrainingApi.create({ base_model: baseModel.trim(), rank: numOr(rank, DEFAULT_LORA.rank), alpha: numOr(alpha, DEFAULT_LORA.alpha) })
      onCreated(c)
    } catch (e) {
      setError(msg(e, 'Failed to create the training client.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor" maxWidth={620}>
      <XStack items="center" justify="space-between">
        <Text fontSize="$5" fontWeight="700">New client</Text>
        <Button size="$2" chromeless icon={<X size={16} />} onPress={onClose} />
      </XStack>

      <FieldRow label="Base model">
        <FieldText value={baseModel} onChange={setBaseModel} placeholder="HuggingFaceTB/SmolLM2-135M" />
      </FieldRow>
      <FieldRow label="LoRA rank">
        <FieldText value={rank} onChange={setRank} placeholder={String(DEFAULT_LORA.rank)} />
      </FieldRow>
      <FieldRow label="LoRA alpha">
        <FieldText value={alpha} onChange={setAlpha} placeholder={String(DEFAULT_LORA.alpha)} />
      </FieldRow>
      <Text fontSize="$1" color="$color10">
        A LoRA adapter attaches to the {DEFAULT_LORA.target_modules.length} Llama projections ({DEFAULT_LORA.target_modules.join(', ')}).
      </Text>

      {error ? (
        <YStack gap="$1" p="$3" rounded="$3" bg="$color3">
          <Text fontSize="$3" fontWeight="700" color={ERR}>Could not create the client</Text>
          <Text fontSize="$2" color="$color11">{error}</Text>
        </YStack>
      ) : null}

      <XStack>
        <Button theme="light" icon={busy ? undefined : <Plus size={16} />} disabled={!canCreate} onPress={() => void create()}>
          {busy ? <XStack gap="$2" items="center"><Spinner size="small" /><Text>Creating…</Text></XStack> : 'Create client'}
        </Button>
      </XStack>
    </Card>
  )
}

// ── Client detail: loss curve + train + sample + save ──────────────────────────────────

function lossPoints(loss: number[]): ChartPoint[] {
  return loss.map((v, i) => ({ label: String(i + 1), value: v }))
}

function ClientDetail({ client, onChanged }: { client: TrainingClientDetail; onChanged: () => void }) {
  // Train box
  const [rows, setRows] = useState(SAMPLE_JSONL)
  const [lr, setLr] = useState('1e-4')
  const [training, setTraining] = useState(false)
  const [trainError, setTrainError] = useState<string | null>(null)
  const [trainNote, setTrainNote] = useState<string | null>(null)

  // Sample box
  const [prompt, setPrompt] = useState('2 + 2 =')
  const [maxTokens, setMaxTokens] = useState('64')
  const [temperature, setTemperature] = useState('0.7')
  const [sampling, setSampling] = useState(false)
  const [sampleText, setSampleText] = useState<string | null>(null)
  const [sampleError, setSampleError] = useState<string | null>(null)

  // Save box
  const [name, setName] = useState('adapter')
  const [saving, setSaving] = useState(false)
  const [savedPath, setSavedPath] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  const ready = client.status === 'ready'
  const points = useMemo(() => lossPoints(client.loss_history), [client.loss_history])

  const step = async () => {
    setTrainError(null)
    setTrainNote(null)
    const parsed = parseTrainingData(rows)
    if (parsed.error) {
      setTrainError(parsed.error)
      return
    }
    setTraining(true)
    try {
      const fb = await TrainingApi.forwardBackward(client.id, parsed.data)
      await TrainingApi.optimStep(client.id, { lr: numOr(lr, 1e-4) })
      setTrainNote(`Step applied — loss ${fmtLoss(fb.loss)} over ${fmtInt(fb.num_tokens)} tokens.`)
      onChanged()
    } catch (e) {
      setTrainError(msg(e, 'The training step failed.'))
    } finally {
      setTraining(false)
    }
  }

  const runSample = async () => {
    setSampleError(null)
    setSampleText(null)
    setSampling(true)
    try {
      const r = await TrainingApi.sample(client.id, {
        prompt,
        sampling_params: { max_tokens: numOr(maxTokens, 64), temperature: numOr(temperature, 0.7) },
        num_samples: 1,
      })
      setSampleText(r.sequences[0]?.text ?? '')
    } catch (e) {
      setSampleError(msg(e, 'Sampling failed.'))
    } finally {
      setSampling(false)
    }
  }

  const save = async () => {
    setSaveError(null)
    setSavedPath(null)
    setSaving(true)
    try {
      const r = await TrainingApi.saveWeights(client.id, name.trim() || 'adapter')
      setSavedPath(r.path)
    } catch (e) {
      setSaveError(msg(e, 'Could not save the adapter.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <YStack gap="$3">
      <XStack gap="$2" items="center" flexWrap="wrap">
        <Text fontSize="$5" fontWeight="700" color="$color12" className="hz-mono">{client.id}</Text>
        <StatusTag status={client.status} />
        <Text fontSize="$2" color="$color10">{client.base_model}</Text>
      </XStack>
      {client.status === 'failed' && client.error ? (
        <YStack gap="$1" p="$3" rounded="$3" bg="$color3">
          <Text fontSize="$3" fontWeight="700" color={ERR}>Client failed to load</Text>
          <Text fontSize="$2" color="$color11">{client.error}</Text>
        </YStack>
      ) : null}

      <XStack gap="$3" flexWrap="wrap" items="flex-start">
        <Panel title="Loss curve" minW={360}>
          {points.length >= 2 ? (
            <YStack gap="$1">
              <LineChart data={points} formatValue={(v) => v.toFixed(3)} />
              <Text fontSize="$1" color="$color10">{points.length} steps · last {fmtLoss(points[points.length - 1]?.value)}</Text>
            </YStack>
          ) : (
            <YStack height={140} items="center" justify="center" borderWidth={1} borderColor="$borderColor" borderStyle="dashed" rounded="$3">
              <Text fontSize="$2" color="$color10" text="center" maxW={320}>
                {points.length === 1 ? `One step so far · loss ${fmtLoss(points[0]?.value)}` : 'Run a training step to plot the loss curve.'}
              </Text>
            </YStack>
          )}
        </Panel>

        <Panel title="Train" minW={360}>
          <YStack gap="$2">
            <Text fontSize="$2" color="$color10">One JSON row per line: {'{"prompt","completion"}'} — a forward/backward pass then an Adam step.</Text>
            <FieldTextArea value={rows} onChange={setRows} rows={5} disabled={!ready || training} />
            <FieldRow label="Learning rate">
              <FieldText value={lr} onChange={setLr} placeholder="1e-4" disabled={!ready || training} />
            </FieldRow>
            {trainError ? <Text fontSize="$2" color={ERR}>{trainError}</Text> : null}
            {trainNote ? <Text fontSize="$2" color={OK}>{trainNote}</Text> : null}
            <XStack>
              <Button theme="light" icon={training ? undefined : <Play size={16} />} disabled={!ready || training} onPress={() => void step()}>
                {training ? <XStack gap="$2" items="center"><Spinner size="small" /><Text>Stepping…</Text></XStack> : 'Step'}
              </Button>
            </XStack>
          </YStack>
        </Panel>
      </XStack>

      <XStack gap="$3" flexWrap="wrap" items="flex-start">
        <Panel title="Sample" minW={360}>
          <YStack gap="$2">
            <FieldRow label="Prompt">
              <FieldText value={prompt} onChange={setPrompt} placeholder="2 + 2 =" disabled={!ready || sampling} />
            </FieldRow>
            <FieldRow label="Max tokens">
              <FieldText value={maxTokens} onChange={setMaxTokens} placeholder="64" disabled={!ready || sampling} />
            </FieldRow>
            <FieldRow label="Temperature">
              <FieldText value={temperature} onChange={setTemperature} placeholder="0.7" disabled={!ready || sampling} />
            </FieldRow>
            {sampleError ? <Text fontSize="$2" color={ERR}>{sampleError}</Text> : null}
            {sampleText !== null ? (
              <YStack gap="$1" p="$3" rounded="$3" bg="$color2" borderWidth={1} borderColor="$borderColor">
                <Text fontSize="$1" color="$color10">Sampled</Text>
                <Text fontSize="$3" color="$color12" className="hz-mono">{sampleText || '(empty)'}</Text>
              </YStack>
            ) : null}
            <XStack>
              <Button theme="light" icon={sampling ? undefined : <Sparkles size={16} />} disabled={!ready || sampling} onPress={() => void runSample()}>
                {sampling ? <XStack gap="$2" items="center"><Spinner size="small" /><Text>Sampling…</Text></XStack> : 'Sample'}
              </Button>
            </XStack>
          </YStack>
        </Panel>

        <Panel title="Save adapter" minW={360}>
          <YStack gap="$2">
            <Text fontSize="$2" color="$color10">Export the trained LoRA weights as a PEFT adapter.</Text>
            <FieldRow label="Name">
              <FieldText value={name} onChange={setName} placeholder="adapter" disabled={!ready || saving} />
            </FieldRow>
            {saveError ? <Text fontSize="$2" color={ERR}>{saveError}</Text> : null}
            {savedPath !== null ? (
              <YStack gap="$1" p="$3" rounded="$3" bg="$color2" borderWidth={1} borderColor="$borderColor">
                <Text fontSize="$1" color="$color10">Saved (peft)</Text>
                <Text fontSize="$3" color="$color12" className="hz-mono">{savedPath || '(no path returned)'}</Text>
              </YStack>
            ) : null}
            <XStack>
              <Button theme="light" icon={saving ? undefined : <Save size={16} />} disabled={!ready || saving} onPress={() => void save()}>
                {saving ? <XStack gap="$2" items="center"><Spinner size="small" /><Text>Saving…</Text></XStack> : 'Save adapter'}
              </Button>
            </XStack>
          </YStack>
        </Panel>
      </XStack>
    </YStack>
  )
}

// ── Module ─────────────────────────────────────────────────────────────────────────

export function InteractiveTraining() {
  const [clients, setClients] = useState<Async<TrainingClientInfo[]>>({ phase: 'loading' })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [detail, setDetail] = useState<Async<TrainingClientDetail> | null>(null)
  const [showNew, setShowNew] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const loadClients = useCallback(() => {
    TrainingApi.list()
      .then((data) => setClients({ phase: 'ready', data }))
      .catch((e) => setClients({ phase: 'error', error: classifyBackend(e) }))
  }, [])

  const loadDetail = useCallback((id: string) => {
    TrainingApi.get(id)
      .then((data) => setDetail({ phase: 'ready', data }))
      .catch((e) => setDetail({ phase: 'error', error: classifyBackend(e) }))
  }, [])

  useEffect(() => loadClients(), [loadClients])

  useEffect(() => {
    if (!selectedId) {
      setDetail(null)
      return
    }
    setDetail({ phase: 'loading' })
    loadDetail(selectedId)
  }, [selectedId, loadDetail])

  const rows = clients.phase === 'ready' ? clients.data : []
  // Open the create form by default when there's nothing yet.
  useEffect(() => {
    if (clients.phase === 'ready' && clients.data.length === 0) setShowNew(true)
  }, [clients.phase, rows.length])

  const anyLoading = rows.some((c) => c.status === 'loading')
  const detailLoading = detail?.phase === 'ready' && detail.data.status === 'loading'

  // Poll while any client (or the open one) is still warming up.
  useEffect(() => {
    if (!anyLoading && !detailLoading) return
    const t = setInterval(() => {
      loadClients()
      if (selectedId) loadDetail(selectedId)
    }, POLL_MS)
    return () => clearInterval(t)
  }, [anyLoading, detailLoading, selectedId, loadClients, loadDetail])

  const del = async (id: string) => {
    setNotice(null)
    try {
      await TrainingApi.remove(id)
    } catch (e) {
      setNotice(msg(e, 'Could not delete the client.'))
    }
    if (selectedId === id) setSelectedId(null)
    loadClients()
  }

  const reloadOpen = useCallback(() => {
    loadClients()
    if (selectedId) loadDetail(selectedId)
  }, [loadClients, loadDetail, selectedId])

  const columns: Column<TrainingClientInfo>[] = [
    {
      key: 'client',
      header: 'Client',
      render: (c) => (
        <YStack>
          <Text fontSize="$3" fontWeight="600" color="$color12" numberOfLines={1} className="hz-mono">{c.id}</Text>
          <Text fontSize="$1" color="$color10" numberOfLines={1}>{c.base_model || '—'}</Text>
        </YStack>
      ),
    },
    { key: 'status', header: 'Status', width: 110, render: (c) => <StatusTag status={c.status} /> },
    { key: 'params', header: 'Trainable', width: 120, mono: true, align: 'right', render: (c) => <Text fontSize="$3" color="$color11" className="hz-tnum">{fmtInt(c.trainable_params)}</Text> },
    { key: 'fb', header: 'fwd/bwd', width: 100, mono: true, align: 'right', render: (c) => <Text fontSize="$3" color="$color11" className="hz-tnum">{fmtInt(c.forward_backward_calls)}</Text> },
    { key: 'steps', header: 'Optim steps', width: 110, mono: true, align: 'right', render: (c) => <Text fontSize="$3" color="$color11" className="hz-tnum">{fmtInt(c.optim_steps)}</Text> },
    { key: 'loss', header: 'Last loss', width: 100, mono: true, align: 'right', render: (c) => <Text fontSize="$3" color="$color11" className="hz-tnum">{fmtLoss(c.last_loss)}</Text> },
    {
      key: 'actions',
      header: '',
      width: 70,
      render: (c) => (
        <XStack justify="flex-end" flex={1}>
          <Button size="$2" chromeless icon={<Trash2 size={15} />} onPress={() => void del(c.id)} />
        </XStack>
      ),
    },
  ]

  return (
    <YStack gap="$3">
      <XStack gap="$2" items="center" justify="space-between" flexWrap="wrap">
        <Text fontSize="$3" color="$color11" maxW={620}>
          Create a live LoRA client, drive it with forward/backward + optimizer steps, sample from it, and export a PEFT adapter — the interactive (Tinker-style) plane.
        </Text>
        <XStack gap="$2">
          <Button icon={<RefreshCw size={16} />} onPress={loadClients}>Refresh</Button>
          <Button theme="light" icon={<Plus size={16} />} onPress={() => setShowNew((v) => !v)}>New client</Button>
        </XStack>
      </XStack>

      {showNew ? (
        <NewClientForm
          onClose={() => setShowNew(false)}
          onCreated={(c) => {
            setShowNew(false)
            setSelectedId(c.id)
            loadClients()
          }}
        />
      ) : null}

      {notice ? <Text fontSize="$2" color={ERR}>{notice}</Text> : null}

      {clients.phase === 'error' ? (
        <BackendStateCard state={clients.error} onRetry={loadClients} hint="Clients come from the engine training plane (/v1/training/clients) via the keyless AI proxy." />
      ) : (
        <DataTable
          columns={columns}
          rows={rows}
          loading={clients.phase === 'loading'}
          rowKey={(c) => c.id}
          onRowPress={(c) => setSelectedId(c.id)}
          empty="No training clients yet. Create one above."
        />
      )}

      {selectedId && detail ? (
        detail.phase === 'error' ? (
          <BackendStateCard state={detail.error} onRetry={reloadOpen} hint="This client is read from /v1/training/clients/{id}." />
        ) : detail.phase === 'loading' ? (
          <XStack gap="$2" items="center"><Spinner size="small" /><Text fontSize="$2" color="$color10">Loading client…</Text></XStack>
        ) : (
          <ClientDetail client={detail.data} onChanged={reloadOpen} />
        )
      ) : null}
    </YStack>
  )
}
