'use client'

/**
 * Fine-tuning — an Unsloth-class, HuggingFace-native, cloud training experience.
 *
 * One tabbed surface over the cloud broker (`/training` → hanzoai/ai
 * `/v1/finetune/*`): browse/search HuggingFace base models + datasets (private via
 * the org's KMS token), start a LoRA/QLoRA/full run with recommended efficient
 * defaults on our GPU pool (a real `trainer.kubeflow.org` TrainJob), watch live
 * status + checkpoints, and deploy a finished model to inference on api.hanzo.ai in
 * one click — billed through the same ledger. Saved configs make a run repeatable.
 *
 * Navigation is internal (tab + selected-job state), so this module owns its whole
 * surface without new registry routes.
 */
import { useEffect, useState, type ComponentType } from 'react'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { Boxes, Database, Layers, ListChecks, Plus, Sparkles, Trash2 } from '@hanzogui/lucide-icons-2'

import { PageHeader } from '~/components/ui/PageHeader'
import { useToast } from '~/components/ui/Toast'
import type { CreateFinetuneInput } from '~/lib/api/finetune'
import { JobsView } from './finetuning/JobsView'
import { JobDetail } from './finetuning/JobDetail'
import { NewJobPanel } from './finetuning/NewJobPanel'
import { HfPicker } from './finetuning/HfPicker'
import { loadConfigs, removeConfig, saveConfigs, methodLabel, type SavedConfig } from './finetuning/logic'

type Tab = 'jobs' | 'new' | 'models' | 'datasets' | 'configs'

function TabButton({
  active,
  label,
  Icon,
  onPress,
}: {
  active: boolean
  label: string
  Icon: ComponentType<{ size?: number }>
  onPress: () => void
}) {
  return (
    <Button
      size="$2"
      icon={<Icon size={15} />}
      bg={active ? '$color5' : 'transparent'}
      borderWidth={1}
      borderColor="$borderColor"
      onPress={onPress}
    >
      {label}
    </Button>
  )
}

export function FinetuningModule(_props: { params: Record<string, string> }) {
  const [tab, setTab] = useState<Tab>('jobs')
  const [selectedJob, setSelectedJob] = useState<string | null>(null)
  const [prefill, setPrefill] = useState<Partial<CreateFinetuneInput> | undefined>(undefined)

  const openNew = (pf?: Partial<CreateFinetuneInput>) => {
    setPrefill(pf)
    setSelectedJob(null)
    setTab('new')
  }

  return (
    <YStack gap="$3">
      <PageHeader
        title="Fine-tuning"
        subtitle="Train HuggingFace models on your data and deploy them to inference."
        actions={
          <Button icon={<Plus size={16} />} onPress={() => openNew(undefined)}>
            New training job
          </Button>
        }
      />

      <XStack gap="$1.5" flexWrap="wrap">
        <TabButton active={tab === 'jobs'} label="Jobs" Icon={ListChecks} onPress={() => { setSelectedJob(null); setTab('jobs') }} />
        <TabButton active={tab === 'new'} label="New job" Icon={Sparkles} onPress={() => openNew(prefill)} />
        <TabButton active={tab === 'models'} label="Models" Icon={Boxes} onPress={() => setTab('models')} />
        <TabButton active={tab === 'datasets'} label="Datasets" Icon={Database} onPress={() => setTab('datasets')} />
        <TabButton active={tab === 'configs'} label="Configs" Icon={Layers} onPress={() => setTab('configs')} />
      </XStack>

      {tab === 'jobs' ? (
        selectedJob ? (
          <JobDetail name={selectedJob} onBack={() => setSelectedJob(null)} />
        ) : (
          <JobsView onOpen={(name) => setSelectedJob(name)} onNew={() => openNew(undefined)} />
        )
      ) : null}

      {tab === 'new' ? (
        <NewJobPanel
          prefill={prefill}
          onCreated={(job) => {
            setSelectedJob(job.name)
            setTab('jobs')
          }}
        />
      ) : null}

      {tab === 'models' ? (
        <YStack gap="$2">
          <Text fontSize="$2" color="$color10">
            Browse HuggingFace models. Pick one to start a fine-tune with it as the base.
          </Text>
          <HfPicker kind="model" taskFilter="text-generation" ctaLabel="Fine-tune" onSelect={(id) => openNew({ baseModel: id })} />
        </YStack>
      ) : null}

      {tab === 'datasets' ? (
        <YStack gap="$2">
          <Text fontSize="$2" color="$color10">
            Browse HuggingFace datasets. Pick one to start a fine-tune with it.
          </Text>
          <HfPicker kind="dataset" ctaLabel="Use" onSelect={(id) => openNew({ dataset: id })} />
        </YStack>
      ) : null}

      {tab === 'configs' ? <ConfigsView onUse={(input) => openNew(input)} /> : null}
    </YStack>
  )
}

function ConfigsView({ onUse }: { onUse: (input: CreateFinetuneInput) => void }) {
  const toast = useToast()
  const [configs, setConfigs] = useState<SavedConfig[]>([])

  useEffect(() => {
    setConfigs(loadConfigs())
  }, [])

  const remove = (name: string) => {
    const next = removeConfig(configs, name)
    setConfigs(next)
    saveConfigs(next)
    toast.info('Removed config', name)
  }

  if (configs.length === 0) {
    return (
      <Card borderWidth={1} borderColor="$borderColor" borderStyle="dashed" p="$6" gap="$2" items="center" maxW={520} self="center">
        <Layers size={22} />
        <Text fontSize="$4" fontWeight="700">
          No saved configs
        </Text>
        <Text fontSize="$3" color="$color11" text="center">
          Build a job in “New job” and choose “Save as config” to reuse its settings later.
        </Text>
      </Card>
    )
  }

  return (
    <YStack borderWidth={1} borderColor="$borderColor" rounded="$4" overflow="hidden">
      {configs.map((c, i) => (
        <XStack key={c.name} py="$3" px="$3" gap="$3" items="center" borderTopWidth={i === 0 ? 0 : 1} borderColor="$borderColor">
          <YStack flex={1} gap="$1">
            <Text fontSize="$3" fontWeight="600" color="$color12">
              {c.name}
            </Text>
            <Text fontSize="$1" color="$color10" numberOfLines={1}>
              {c.input.baseModel} · {methodLabel(c.input.method)} · {c.input.dataset}
            </Text>
          </YStack>
          <Button size="$2" onPress={() => onUse(c.input)}>
            Use
          </Button>
          <Button size="$2" circular icon={<Trash2 size={14} />} onPress={() => remove(c.name)} />
        </XStack>
      ))}
    </YStack>
  )
}
