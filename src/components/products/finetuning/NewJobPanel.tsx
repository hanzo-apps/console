'use client'

/**
 * New training job — the Unsloth-class create panel. Sane defaults make it runnable
 * on open (a flagship base model + a classic instruction dataset + the "Recommended"
 * preset), and the broker's recommendation drives an efficient GPU + a live
 * time/cost estimate. Base model and dataset are pickable from HuggingFace (any
 * repo id works — paste or browse); private/gated repos resolve via the org's KMS
 * token server-side. Submitting POSTs a real job to `/training/jobs`, which creates
 * a `trainer.kubeflow.org` TrainJob on the GPU pool.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Card, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { Rocket, Save, Search, Sparkles, X } from '@hanzogui/lucide-icons-2'

import {
  FinetuneApi,
  type CreateFinetuneInput,
  type FinetuneCatalog,
  type FinetuneJob,
  type FinetuneRecommendation,
  type Hyperparams,
} from '~/lib/api/finetune'
import { FieldRow, FieldSelect, FieldSlider, FieldSwitch, FieldText } from '~/components/ui/Field'
import { PrimaryButton } from '~/components/ui/PrimaryButton'
import { useToast } from '~/components/ui/Toast'
import { HfPicker } from './HfPicker'
import {
  estimateCostCents,
  formatCents,
  formatDurationMin,
  loadConfigs,
  saveConfigs,
  upsertConfig,
  type SavedConfig,
} from './logic'

const PRESETS_WITH_CUSTOM = (presets: string[]) => [...presets, 'custom']

export function NewJobPanel({
  prefill,
  onCreated,
}: {
  prefill?: Partial<CreateFinetuneInput>
  onCreated: (job: FinetuneJob) => void
}) {
  const toast = useToast()
  const [catalog, setCatalog] = useState<FinetuneCatalog | null>(null)
  const [rec, setRec] = useState<FinetuneRecommendation | null>(null)

  const [displayName, setDisplayName] = useState(prefill?.displayName ?? '')
  const [baseModel, setBaseModel] = useState(prefill?.baseModel ?? 'meta-llama/Llama-3.1-8B-Instruct')
  const [method, setMethod] = useState(prefill?.method ?? 'qlora')
  const [task, setTask] = useState(prefill?.task ?? 'instruct')
  const [dataset, setDataset] = useState(prefill?.dataset ?? 'tatsu-lab/alpaca')
  const [preset, setPreset] = useState(prefill?.preset ?? 'recommended')

  const [gpuTypeOverride, setGpuTypeOverride] = useState('')
  const [gpuCountOverride, setGpuCountOverride] = useState(0)
  const [customHp, setCustomHp] = useState<Hyperparams | null>(prefill?.hyperparams ?? null)

  const [browse, setBrowse] = useState<null | 'model' | 'dataset'>(null)
  const [submitting, setSubmitting] = useState(false)

  // Load the option catalog once.
  useEffect(() => {
    void (async () => {
      try {
        const { catalog } = await FinetuneApi.catalog()
        setCatalog(catalog)
      } catch (e) {
        toast.error('Could not load options', e instanceof Error ? e.message : undefined)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Recompute the recommendation whenever the selection changes.
  useEffect(() => {
    if (!baseModel) return
    let live = true
    void (async () => {
      try {
        const { recommendation } = await FinetuneApi.recommend({ baseModel, method, task, preset })
        if (live) setRec(recommendation)
      } catch {
        /* recommendation is advisory; the form still submits with backend defaults */
      }
    })()
    return () => {
      live = false
    }
  }, [baseModel, method, task, preset])

  const methodOptions = catalog?.methods ?? []
  const methodLabelFor = (id: string) => methodOptions.find((m) => m.id === id)?.displayName ?? id
  const methodIdFor = (label: string) => methodOptions.find((m) => m.displayName === label)?.id ?? 'qlora'

  const gpus = catalog?.gpus ?? []
  const effGpuType = gpuTypeOverride || rec?.gpuType || 'nvidia-a100-80gb'
  const effGpuCount = gpuCountOverride || rec?.gpuCount || 1
  const effNumNodes = rec?.numNodes || 1
  const gpuLabelFor = (type: string) => gpus.find((g) => g.type === type)?.displayName ?? type
  const gpuTypeFor = (label: string) => gpus.find((g) => g.displayName === label)?.type ?? effGpuType
  const hourly = gpus.find((g) => g.type === effGpuType)?.hourlyCents ?? 0

  const estMinutes = rec?.estMinutes ?? 0
  const estCents = useMemo(
    () => estimateCostCents(estMinutes, hourly, effGpuCount, effNumNodes),
    [estMinutes, hourly, effGpuCount, effNumNodes],
  )

  const effHp: Hyperparams | null = preset === 'custom' ? customHp ?? rec?.hyperparams ?? null : rec?.hyperparams ?? null

  // When switching to "custom", seed the editable copy from the recommendation.
  const onPresetChange = useCallback(
    (p: string) => {
      setPreset(p)
      if (p === 'custom' && rec?.hyperparams) setCustomHp({ ...rec.hyperparams })
    },
    [rec],
  )

  const buildInput = (): CreateFinetuneInput => ({
    displayName: displayName || undefined,
    baseModel,
    method,
    task,
    dataset,
    preset,
    hyperparams: preset === 'custom' && customHp ? customHp : undefined,
    gpuType: effGpuType,
    gpuCount: effGpuCount,
    numNodes: effNumNodes,
  })

  const submit = async () => {
    if (!baseModel.trim()) return toast.error('Pick a base model')
    if (!dataset.trim()) return toast.error('Pick a dataset')
    setSubmitting(true)
    try {
      const job = await FinetuneApi.createJob(buildInput())
      if (job.status === 'failed') {
        toast.error('Job created but submit failed', job.error)
      } else {
        toast.success('Training started', job.name)
      }
      onCreated(job)
    } catch (e) {
      toast.error('Could not start training', e instanceof Error ? e.message : undefined)
    } finally {
      setSubmitting(false)
    }
  }

  const saveAsConfig = () => {
    const name = typeof window !== 'undefined' ? window.prompt('Save this configuration as:') : ''
    if (!name) return
    const cfg: SavedConfig = { name, input: buildInput(), savedAt: new Date().toISOString() }
    saveConfigs(upsertConfig(loadConfigs(), cfg))
    toast.success('Saved config', name)
  }

  if (!catalog) {
    return (
      <XStack p="$6" justify="center">
        <Spinner size="large" color="$color11" />
      </XStack>
    )
  }

  if (browse) {
    return (
      <YStack gap="$3">
        <XStack justify="space-between" items="center">
          <Text fontSize="$5" fontWeight="700">
            {browse === 'model' ? 'Choose a base model' : 'Choose a dataset'}
          </Text>
          <Button size="$2" icon={<X size={15} />} onPress={() => setBrowse(null)}>
            Close
          </Button>
        </XStack>
        <HfPicker
          kind={browse}
          taskFilter={browse === 'model' ? 'text-generation' : undefined}
          selected={browse === 'model' ? baseModel : dataset}
          onSelect={(id) => {
            if (browse === 'model') setBaseModel(id)
            else setDataset(id)
            setBrowse(null)
          }}
        />
      </YStack>
    )
  }

  return (
    <YStack gap="$4" maxW={820}>
      <Card borderWidth={1} borderColor="$borderColor" p="$4" gap="$3">
        <FieldRow label="Job name">
          <FieldText value={displayName} onChange={setDisplayName} placeholder="Optional — e.g. support-assistant-v1" />
        </FieldRow>

        <FieldRow label="Base model">
          <YStack gap="$2">
            <XStack gap="$2" items="center">
              <YStack flex={1}>
                <FieldText value={baseModel} onChange={setBaseModel} placeholder="HuggingFace repo id, e.g. meta-llama/Llama-3.1-8B" />
              </YStack>
              <Button icon={<Search size={15} />} onPress={() => setBrowse('model')}>
                Browse
              </Button>
            </XStack>
            <Text fontSize="$1" color="$color10">
              Paste any HuggingFace model id, or browse the Hub. Private/gated repos use your org's HF token.
            </Text>
          </YStack>
        </FieldRow>

        <FieldRow label="Training type">
          <YStack gap="$1">
            <FieldSelect
              value={methodLabelFor(method)}
              options={methodOptions.map((m) => m.displayName)}
              onChange={(label) => setMethod(methodIdFor(label))}
            />
            <Text fontSize="$1" color="$color10">
              {methodOptions.find((m) => m.id === method)?.description}
            </Text>
          </YStack>
        </FieldRow>

        <FieldRow label="Dataset">
          <XStack gap="$2" items="center">
            <YStack flex={1}>
              <FieldText value={dataset} onChange={setDataset} placeholder="HuggingFace dataset id, or hf:// / s3:// URI" />
            </YStack>
            <Button icon={<Search size={15} />} onPress={() => setBrowse('dataset')}>
              Browse
            </Button>
          </XStack>
        </FieldRow>

        <FieldRow label="Task">
          <FieldSelect value={task} options={catalog.tasks} onChange={setTask} />
        </FieldRow>
      </Card>

      <Card borderWidth={1} borderColor="$borderColor" p="$4" gap="$3">
        <XStack gap="$2" items="center">
          <Sparkles size={16} color="$color11" />
          <Text fontSize="$4" fontWeight="700">
            Hyperparameters
          </Text>
        </XStack>
        <FieldRow label="Preset">
          <FieldSelect value={preset} options={PRESETS_WITH_CUSTOM(catalog.presets)} onChange={onPresetChange} />
        </FieldRow>

        {preset === 'custom' && effHp ? (
          <YStack gap="$2">
            <FieldRow label="Epochs">
              <FieldSlider value={effHp.epochs} min={1} max={10} step={1} onChange={(v) => setCustomHp({ ...effHp, epochs: v })} />
            </FieldRow>
            <FieldRow label="Learning rate">
              <FieldText
                value={String(effHp.learningRate)}
                onChange={(v) => {
                  const n = Number(v)
                  setCustomHp({ ...effHp, learningRate: Number.isFinite(n) ? n : effHp.learningRate })
                }}
                placeholder="2e-4"
              />
            </FieldRow>
            <FieldRow label="Batch size">
              <FieldSlider value={effHp.batchSize} min={1} max={32} step={1} onChange={(v) => setCustomHp({ ...effHp, batchSize: v })} />
            </FieldRow>
            <FieldRow label="Max sequence length">
              <FieldSlider value={effHp.maxSeqLen} min={512} max={8192} step={512} onChange={(v) => setCustomHp({ ...effHp, maxSeqLen: v })} />
            </FieldRow>
            {method !== 'full' ? (
              <FieldRow label="LoRA rank">
                <FieldSlider value={effHp.loraRank} min={4} max={128} step={4} onChange={(v) => setCustomHp({ ...effHp, loraRank: v, loraAlpha: v * 2 })} />
              </FieldRow>
            ) : null}
            <FieldRow label="4-bit (QLoRA)">
              <FieldSwitch checked={effHp.quant4bit} onChange={(v) => setCustomHp({ ...effHp, quant4bit: v })} />
            </FieldRow>
            <FieldRow label="Gradient checkpointing">
              <FieldSwitch checked={effHp.gradientCheckpointing} onChange={(v) => setCustomHp({ ...effHp, gradientCheckpointing: v })} />
            </FieldRow>
          </YStack>
        ) : effHp ? (
          <XStack gap="$4" flexWrap="wrap">
            <HpStat label="Epochs" value={String(effHp.epochs)} />
            <HpStat label="Learning rate" value={String(effHp.learningRate)} />
            <HpStat label="Batch" value={String(effHp.batchSize)} />
            <HpStat label="Max seq" value={String(effHp.maxSeqLen)} />
            {method !== 'full' ? <HpStat label="LoRA rank" value={String(effHp.loraRank)} /> : null}
            <HpStat label="4-bit" value={effHp.quant4bit ? 'yes' : 'no'} />
          </XStack>
        ) : null}
      </Card>

      <Card borderWidth={1} borderColor="$borderColor" p="$4" gap="$3">
        <Text fontSize="$4" fontWeight="700">
          Compute
        </Text>
        <FieldRow label="GPU">
          <FieldSelect
            value={gpuLabelFor(effGpuType)}
            options={gpus.map((g) => `${g.displayName} — ${g.memory} (${formatCents(g.hourlyCents)}/hr)`)}
            onChange={(label) => setGpuTypeOverride(gpuTypeFor(label.split(' — ')[0] ?? label))}
          />
        </FieldRow>
        <FieldRow label="GPUs per node">
          <FieldSlider value={effGpuCount} min={1} max={8} step={1} onChange={setGpuCountOverride} />
        </FieldRow>

        <XStack gap="$6" items="center" pt="$2" flexWrap="wrap">
          <YStack>
            <Text fontSize="$1" color="$color10">
              Estimated time
            </Text>
            <Text fontSize="$5" fontWeight="800" color="$color12">
              {formatDurationMin(estMinutes)}
            </Text>
          </YStack>
          <YStack>
            <Text fontSize="$1" color="$color10">
              Estimated cost
            </Text>
            <Text fontSize="$5" fontWeight="800" color="$color12">
              {formatCents(estCents)}
            </Text>
          </YStack>
          {rec ? (
            <YStack>
              <Text fontSize="$1" color="$color10">
                Runtime
              </Text>
              <Text fontSize="$3" color="$color11">
                {rec.runtime}
              </Text>
            </YStack>
          ) : null}
        </XStack>
      </Card>

      <XStack gap="$2" items="center" flexWrap="wrap">
        <PrimaryButton icon={<Rocket size={16} />} disabled={submitting} onPress={() => void submit()}>
          {submitting ? 'Starting…' : 'Start training'}
        </PrimaryButton>
        <Button icon={<Save size={15} />} onPress={saveAsConfig}>
          Save as config
        </Button>
      </XStack>
    </YStack>
  )
}

function HpStat({ label, value }: { label: string; value: string }) {
  return (
    <YStack>
      <Text fontSize="$1" color="$color10">
        {label}
      </Text>
      <Text fontSize="$3" fontWeight="600" color="$color12">
        {value}
      </Text>
    </YStack>
  )
}
