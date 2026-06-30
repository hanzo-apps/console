'use client'

/**
 * Job detail — live status for one fine-tune run. Polls `/training/job` while the
 * run is active (the broker reads the real TrainJob CR each call), shows the
 * loss-curve-stand-in progress + condition message, the checkpoint output location
 * in the org's S3 Space, and the GPU-hours metered to commerce. When the run
 * succeeds, "Deploy to inference" serves the weights via KServe and registers the
 * result as a model on api.hanzo.ai — after which it is callable in the Playground
 * and chat under its model id.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Card, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { ArrowLeft, RefreshCw, Rocket, Ban, Copy, CircleCheck } from '@hanzogui/lucide-icons-2'

import { FinetuneApi, type FinetuneJob, type Hyperparams } from '~/lib/api/finetune'
import { StatusTag } from '~/components/ui/StatusTag'
import { PrimaryButton } from '~/components/ui/PrimaryButton'
import { useToast } from '~/components/ui/Toast'
import { formatCents, formatDurationMin, isActive, isDeployable, jobTitle, methodLabel, progressOf } from './logic'

function parseHp(raw?: string): Hyperparams | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as Hyperparams
  } catch {
    return null
  }
}

function Meta({ label, value }: { label: string; value?: string }) {
  if (!value) return null
  return (
    <YStack gap="$1" minW={160}>
      <Text fontSize="$1" color="$color10">
        {label}
      </Text>
      <Text fontSize="$3" color="$color12" numberOfLines={1}>
        {value}
      </Text>
    </YStack>
  )
}

export function JobDetail({
  name,
  onBack,
  onChanged,
}: {
  name: string
  onBack: () => void
  onChanged?: () => void
}) {
  const toast = useToast()
  const [job, setJob] = useState<FinetuneJob | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(async () => {
    try {
      const j = await FinetuneApi.getJob(name)
      setJob(j)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load job')
    } finally {
      setLoading(false)
    }
  }, [name])

  useEffect(() => {
    void load()
  }, [load])

  // Poll while active.
  useEffect(() => {
    const active = isActive(job?.status)
    if (active && !timer.current) {
      timer.current = setInterval(() => void load(), 5000)
    }
    if (!active && timer.current) {
      clearInterval(timer.current)
      timer.current = null
    }
    return () => {
      if (timer.current) {
        clearInterval(timer.current)
        timer.current = null
      }
    }
  }, [job?.status, load])

  const deploy = async () => {
    if (!job) return
    setBusy(true)
    try {
      const res = await FinetuneApi.deployJob(job.name)
      toast.success('Deploying to inference', `Model id: ${res.modelId}`)
      await load()
      onChanged?.()
    } catch (e) {
      toast.error('Deploy failed', e instanceof Error ? e.message : undefined)
    } finally {
      setBusy(false)
    }
  }

  const cancel = async () => {
    if (!job) return
    setBusy(true)
    try {
      await FinetuneApi.cancelJob(job.name)
      toast.success('Job cancelled', job.name)
      await load()
      onChanged?.()
    } catch (e) {
      toast.error('Cancel failed', e instanceof Error ? e.message : undefined)
    } finally {
      setBusy(false)
    }
  }

  const copy = (text: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(text)
      toast.info('Copied', text)
    }
  }

  if (loading) {
    return (
      <XStack p="$6" justify="center">
        <Spinner size="large" color="$color11" />
      </XStack>
    )
  }
  if (error || !job) {
    return (
      <YStack gap="$3">
        <Button size="$2" self="flex-start" icon={<ArrowLeft size={15} />} onPress={onBack}>
          Back
        </Button>
        <Card borderWidth={1} borderColor="$borderColor" p="$4">
          <Text color="$red10">{error || 'Job not found'}</Text>
        </Card>
      </YStack>
    )
  }

  const hp = parseHp(job.hyperparams)
  const pct = progressOf(job)

  return (
    <YStack gap="$4" maxW={860}>
      <XStack justify="space-between" items="center" gap="$3">
        <XStack gap="$2" items="center" flex={1}>
          <Button size="$2" circular icon={<ArrowLeft size={15} />} onPress={onBack} />
          <Text fontSize="$6" fontWeight="800" numberOfLines={1}>
            {jobTitle(job)}
          </Text>
          <StatusTag status={job.status} />
        </XStack>
        <Button size="$2" icon={<RefreshCw size={15} />} onPress={() => void load()}>
          Refresh
        </Button>
      </XStack>

      {/* Progress + message */}
      <Card borderWidth={1} borderColor="$borderColor" p="$4" gap="$3">
        <XStack justify="space-between" items="center">
          <Text fontSize="$3" fontWeight="600" color="$color11">
            {isActive(job.status) ? 'Training progress' : job.status === 'succeeded' ? 'Complete' : 'Status'}
          </Text>
          <Text fontSize="$3" color="$color11">
            {pct}%
          </Text>
        </XStack>
        <YStack height={8} bg="$color3" rounded="$10" overflow="hidden">
          <YStack height={8} width={(`${pct}%` as unknown) as number} bg={job.status === 'failed' ? '$red9' : '$color9'} />
        </YStack>
        {job.message ? (
          <Text fontSize="$2" color="$color10">
            {job.message}
          </Text>
        ) : null}
        {job.error ? (
          <Card bg="$color2" borderWidth={1} borderColor="$borderColor" p="$3">
            <Text fontSize="$2" color="$red10">
              {job.error}
            </Text>
          </Card>
        ) : null}
      </Card>

      {/* Actions */}
      <XStack gap="$2" items="center" flexWrap="wrap">
        {isDeployable(job) && !job.deployedModel ? (
          <PrimaryButton icon={<Rocket size={16} />} disabled={busy} onPress={() => void deploy()}>
            {busy ? 'Working…' : 'Deploy to inference'}
          </PrimaryButton>
        ) : null}
        {isActive(job.status) ? (
          <Button icon={<Ban size={15} />} disabled={busy} onPress={() => void cancel()}>
            Cancel
          </Button>
        ) : null}
      </XStack>

      {job.deployedModel ? (
        <Card borderWidth={1} borderColor="$green8" bg="$color2" p="$4" gap="$2">
          <XStack gap="$2" items="center">
            <CircleCheck size={16} color="$green10" />
            <Text fontSize="$4" fontWeight="700">
              Deployed to inference
            </Text>
          </XStack>
          <Text fontSize="$3" color="$color11">
            Call this model on api.hanzo.ai as <Text fontWeight="700" color="$color12">{job.deployedModel}</Text> — it is
            now available in the Playground and chat, billed through the same ledger.
          </Text>
          <XStack gap="$2" items="center">
            <Button size="$2" icon={<Copy size={14} />} onPress={() => copy(job.deployedModel ?? '')}>
              Copy model id
            </Button>
            {job.deployUrl ? (
              <Text fontSize="$1" color="$color10" numberOfLines={1}>
                {job.deployUrl}
              </Text>
            ) : null}
          </XStack>
        </Card>
      ) : null}

      {/* Configuration */}
      <Card borderWidth={1} borderColor="$borderColor" p="$4" gap="$3">
        <Text fontSize="$4" fontWeight="700">
          Configuration
        </Text>
        <XStack gap="$5" flexWrap="wrap">
          <Meta label="Base model" value={job.baseModel} />
          <Meta label="Method" value={methodLabel(job.method)} />
          <Meta label="Dataset" value={job.dataset} />
          <Meta label="Task" value={job.task} />
          <Meta label="Runtime" value={job.runtime} />
          <Meta label="GPU" value={job.gpuType ? `${job.gpuCount ?? 1}× ${job.gpuType}` : undefined} />
        </XStack>
        {hp ? (
          <XStack gap="$5" flexWrap="wrap" pt="$2">
            <Meta label="Epochs" value={String(hp.epochs)} />
            <Meta label="Learning rate" value={String(hp.learningRate)} />
            <Meta label="Batch" value={String(hp.batchSize)} />
            <Meta label="Max seq" value={String(hp.maxSeqLen)} />
            {job.method !== 'full' ? <Meta label="LoRA rank" value={String(hp.loraRank)} /> : null}
            <Meta label="4-bit" value={hp.quant4bit ? 'yes' : 'no'} />
          </XStack>
        ) : null}
      </Card>

      {/* Checkpoints + metering */}
      <Card borderWidth={1} borderColor="$borderColor" p="$4" gap="$3">
        <Text fontSize="$4" fontWeight="700">
          Checkpoints & usage
        </Text>
        <XStack gap="$5" flexWrap="wrap">
          <Meta label="Checkpoint output" value={job.outputUri} />
          <Meta label="GPU-hours" value={job.gpuSeconds ? `${(job.gpuSeconds / 3600).toFixed(2)} h` : undefined} />
          <Meta label="Metered cost" value={job.costCents ? formatCents(job.costCents) : undefined} />
          <Meta label="Created" value={job.createdTime ? new Date(job.createdTime).toLocaleString() : undefined} />
          <Meta label="Est. duration" value={job.startedTime && job.finishedTime ? durationBetween(job.startedTime, job.finishedTime) : undefined} />
        </XStack>
        <Text fontSize="$1" color="$color10">
          Checkpoints are written to your org's S3 Space. Deploying serves them on our GPUs via KServe.
        </Text>
      </Card>
    </YStack>
  )
}

function durationBetween(start: string, end: string): string {
  const ms = new Date(end).getTime() - new Date(start).getTime()
  if (!Number.isFinite(ms) || ms <= 0) return ''
  return formatDurationMin(Math.round(ms / 60000))
}
