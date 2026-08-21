'use client'

/**
 * New training job — the create panel for the Training console. The base-model
 * picker is the REAL model catalog (`aicatalog.fetchCatalog`, zen-first, available
 * models); training type / dataset / hyperparams / compute are user inputs.
 * "Start training job" POSTs the real `/v1/ai/finetune/jobs` (via the `/training` proxy);
 * that endpoint is billing-gated by the ResourceMeter, so an unfunded org gets a
 * 402 which is surfaced HONESTLY inline (never swallowed). "Save as config" stores
 * the inputs client-side for reuse. No fabricated success — the row only appears
 * after the backend confirms.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { Play, Save, X } from '@hanzogui/lucide-icons-2'

import { ApiError } from '~/lib/api'
import { TrainApi, TRAIN_TYPES, TRAIN_PRESETS, TRAIN_GPUS, type CreateTrainJobInput } from '~/lib/api/train'
import { fetchCatalog, modelId, isZen, type CatalogEntry } from '~/lib/api/aicatalog'
import { saveConfig } from '~/lib/training-configs'
import { usd } from '~/lib/api/compute'
import { toneColor } from '~/components/ui/tone'
import { FieldRow, FieldSelect, FieldText } from '@hanzo/ui/product'

/** Realistic base models to train from: available + text, our own Zen first. */
function baseModelOptions(cat: CatalogEntry[]): string[] {
  const ids = cat
    .filter((m) => m.available)
    .filter((m) => {
      const n = `${m.name ?? ''} ${m.id ?? ''}`.toLowerCase()
      return !/(embed|rerank|tts|whisper|image|diffusion|dall|-asr)/.test(n)
    })
    .sort((a, b) => Number(isZen(b)) - Number(isZen(a)))
    .map(modelId)
    .filter(Boolean)
  return Array.from(new Set(ids)).slice(0, 80)
}

export function NewTrainingPanel({
  org,
  onCreated,
  onClose,
}: {
  org: string
  onCreated: () => void
  onClose: () => void
}) {
  const [models, setModels] = useState<string[]>([])
  const [catalogFailed, setCatalogFailed] = useState(false)

  const [baseModel, setBaseModel] = useState('')
  const [type, setType] = useState<string>(TRAIN_TYPES[0].id)
  const [dataset, setDataset] = useState('')
  const [learningRate, setLearningRate] = useState('2e-4')
  const [batchSize, setBatchSize] = useState('8')
  const [epochs, setEpochs] = useState('3')
  const [preset, setPreset] = useState<string>(TRAIN_PRESETS[0])
  const [gpuId, setGpuId] = useState<string>(TRAIN_GPUS[0].id)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [billing, setBilling] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    let live = true
    fetchCatalog()
      .then((cat) => {
        if (!live) return
        const opts = baseModelOptions(cat)
        setModels(opts)
        setBaseModel((cur) => cur || opts[0] || '')
      })
      .catch(() => live && setCatalogFailed(true))
    return () => {
      live = false
    }
  }, [])

  const gpu = TRAIN_GPUS.find((g) => g.id === gpuId) ?? TRAIN_GPUS[0]
  const typeLabel = TRAIN_TYPES.find((t) => t.id === type)?.label ?? type

  const build = useCallback(
    (): CreateTrainJobInput => ({
      baseModel: baseModel.trim(),
      type,
      dataset: dataset.trim(),
      hyperparams: {
        learningRate: Number(learningRate) || undefined,
        batchSize: Number(batchSize) || undefined,
        epochs: Number(epochs) || undefined,
        preset,
      },
      gpu: gpu.gpu,
      gpuCount: gpu.gpuCount,
    }),
    [baseModel, type, dataset, learningRate, batchSize, epochs, preset, gpu],
  )

  const canStart = baseModel.trim() && dataset.trim() && !busy

  const start = async () => {
    setBusy(true)
    setError(null)
    setBilling(false)
    try {
      await TrainApi.createJob(build())
      onCreated()
      onClose()
    } catch (e) {
      if (e instanceof ApiError && e.status === 402) setBilling(true)
      setError(e instanceof Error ? e.message : 'The training job was not started, so nothing is queued and nothing is billed. Try again.')
    } finally {
      setBusy(false)
    }
  }

  const save = () => {
    saveConfig(org, {
      name: `${baseModel.split('/').pop() || baseModel} · ${typeLabel}`,
      baseModel,
      type,
      dataset,
      learningRate: Number(learningRate) || 0,
      batchSize: Number(batchSize) || 0,
      epochs: Number(epochs) || 0,
      preset,
      gpu: gpu.gpu,
      gpuCount: gpu.gpuCount,
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  return (
    <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor" maxWidth={620}>
      <XStack items="center" justify="space-between">
        <Text fontSize="$5" fontWeight="700">New training job</Text>
        <Button size="$2" chromeless icon={<X size={16} />} onPress={onClose} />
      </XStack>

      <FieldRow label="Base model">
        {models.length ? (
          <FieldSelect value={baseModel} options={models} onChange={setBaseModel} />
        ) : (
          <YStack gap="$1">
            <FieldText value={baseModel} onChange={setBaseModel} placeholder="e.g. zen-nano or meta-llama/Llama-3.1-8B" />
            {catalogFailed ? <Text fontSize="$1" color="$color10">Model catalog unavailable — enter a base model id.</Text> : (
              <XStack gap="$2" items="center"><Spinner size="small" /><Text fontSize="$1" color="$color10">Loading catalog…</Text></XStack>
            )}
          </YStack>
        )}
      </FieldRow>

      <FieldRow label="Training type">
        <FieldSelect value={typeLabel} options={TRAIN_TYPES.map((t) => t.label)} onChange={(lbl) => setType(TRAIN_TYPES.find((t) => t.label === lbl)?.id ?? type)} />
      </FieldRow>

      <FieldRow label="Dataset">
        <FieldText value={dataset} onChange={setDataset} placeholder="HF dataset id or a Store / dataset name" />
      </FieldRow>

      <FieldRow label="Learning rate">
        <FieldText value={learningRate} onChange={setLearningRate} placeholder="2e-4" />
      </FieldRow>
      <FieldRow label="Batch size">
        <FieldText value={batchSize} onChange={setBatchSize} placeholder="8" />
      </FieldRow>
      <FieldRow label="Epochs">
        <FieldText value={epochs} onChange={setEpochs} placeholder="3" />
      </FieldRow>
      <FieldRow label="Preset">
        <FieldSelect value={preset} options={[...TRAIN_PRESETS]} onChange={setPreset} />
      </FieldRow>

      <FieldRow label="Compute">
        <YStack gap="$1">
          <FieldSelect value={gpu.label} options={TRAIN_GPUS.map((g) => g.label)} onChange={(lbl) => setGpuId(TRAIN_GPUS.find((g) => g.label === lbl)?.id ?? gpuId)} />
          <Text fontSize="$1" color="$color10">{usd(gpu.hourlyCents)}/hr · billed per GPU-hour by usage (final cost is metered).</Text>
        </YStack>
      </FieldRow>

      {error ? (
        <YStack gap="$1" p="$3" rounded="$3" bg="$color3">
          <Text fontSize="$3" fontWeight="700" color={toneColor(billing ? 'warning' : 'critical')}>
            {billing ? 'Add credits to start training' : 'Could not start the job'}
          </Text>
          <Text fontSize="$2" color="$color11">{error}</Text>
        </YStack>
      ) : null}

      <XStack gap="$2" flexWrap="wrap">
        <Button theme="light" icon={<Play size={16} />} disabled={!canStart} onPress={() => void start()}>
          {busy ? 'Starting…' : 'Start training job'}
        </Button>
        <Button icon={<Save size={16} />} disabled={!baseModel.trim()} onPress={save}>
          {saved ? 'Saved' : 'Save as config'}
        </Button>
      </XStack>
    </Card>
  )
}
