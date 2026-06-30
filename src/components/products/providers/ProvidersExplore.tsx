'use client'

/**
 * Providers — Explore. The real provider catalog, grouped from
 * `/v1/pricing/models`: every provider that actually serves models (Zen, OpenAI,
 * Qwen, Anthropic, Meta, Mistral, …) as a card with its model count, context
 * reach, cheapest input price, and a few model chips. Three action cards lead to
 * the real flows (custom models, BYO weights, the unified API). Honest
 * loading/error/empty — never a fabricated provider. "Add custom" / per-provider
 * detail stay in the REST surface (the List/Edit views).
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Text, XStack, YStack } from '@hanzo/gui'
import { Boxes, Upload, Code2, ArrowRight, ArrowLeft, Plus } from '@hanzogui/lucide-icons-2'

import {
  fetchCatalog,
  groupByProvider,
  displayProvider,
  modelType,
  fmtPrice,
  fmtContext,
  type ProviderGroup,
} from '~/lib/api/aicatalog'
import { PageHeader } from '~/components/ui/PageHeader'
import { ErrorState, asApiError } from '~/components/ui/States'
import { Loader } from '~/components/ui/Loader'
import type { ApiError } from '~/lib/api'

function ActionCard({
  icon,
  title,
  body,
  cta,
  onPress,
}: {
  icon: ReactNode
  title: string
  body: string
  cta: string
  onPress: () => void
}) {
  return (
    <YStack
      flex={1}
      minW={240}
      gap="$2"
      p="$3.5"
      rounded="$4"
      borderWidth={1}
      borderColor="$borderColor"
      bg="$color1"
    >
      <XStack items="center" gap="$2">
        {icon}
        <Text fontSize="$4" fontWeight="700" color="$color12">
          {title}
        </Text>
      </XStack>
      <Text fontSize="$2" color="$color10" flex={1}>
        {body}
      </Text>
      <Button size="$2" self="flex-start" onPress={onPress}>
        {cta}
      </Button>
    </YStack>
  )
}

function ProviderCard({ g, onOpen }: { g: ProviderGroup; onOpen: () => void }) {
  const name = displayProvider(g.provider)
  return (
    <YStack
      width={300}
      gap="$2.5"
      p="$3.5"
      rounded="$4"
      borderWidth={1}
      borderColor="$borderColor"
      bg="$color1"
      hoverStyle={{ borderColor: '$color8' }}
    >
      <Text fontSize="$5" fontWeight="700" color="$color12">
        {name}
      </Text>
      <XStack gap="$3" flexWrap="wrap">
        <Text fontSize="$1" color="$color10">
          {g.count} {g.count === 1 ? 'model' : 'models'}
        </Text>
        <Text fontSize="$1" color="$color10">
          {fmtContext(g.maxContext)} context
        </Text>
        <Text fontSize="$1" color="$color10">
          from {fmtPrice(g.minInput)} / Mtok
        </Text>
      </XStack>
      <XStack gap="$1" flexWrap="wrap">
        {g.sample.map((s) => (
          <Text key={s} fontSize="$1" px="$2" py="$1" rounded="$2" bg="$color3" color="$color11">
            {s}
          </Text>
        ))}
        {g.count > g.sample.length ? (
          <Text fontSize="$1" px="$2" py="$1" rounded="$2" bg="$color3" color="$color11">
            +{g.count - g.sample.length}
          </Text>
        ) : null}
      </XStack>
      <Button
        size="$2"
        chromeless
        self="flex-start"
        iconAfter={<ArrowRight size={14} />}
        onPress={onOpen}
      >
        View models
      </Button>
    </YStack>
  )
}

const Stat = ({ label, value }: { label: string; value: string }) => (
  <YStack flex={1} minW={140} gap={2} px="$3" py="$2.5">
    <Text fontSize="$6" fontWeight="700" color="$color12">
      {value}
    </Text>
    <Text fontSize="$1" color="$color10">
      {label}
    </Text>
  </YStack>
)

/** Provider detail — metadata + the provider's full model list. */
function ProviderDetailPanel({ g, onBack }: { g: ProviderGroup; onBack: () => void }) {
  const name = displayProvider(g.provider)
  const availableCount = g.models.filter((m) => m.available).length
  return (
    <YStack gap="$4">
      <Button size="$2" chromeless self="flex-start" icon={<ArrowLeft size={16} />} onPress={onBack}>
        Providers
      </Button>

      <Text fontSize="$8" fontWeight="800" color="$color12">
        {name}
      </Text>

      <XStack
        gap="$5"
        flexWrap="wrap"
        rounded="$4"
        borderWidth={1}
        borderColor="$borderColor"
        bg="$color1"
        p="$4"
      >
        <YStack gap={2} minW={120}>
          <Text fontSize="$6" fontWeight="700" color="$color12">{String(g.count)}</Text>
          <Text fontSize="$1" color="$color10">Models</Text>
        </YStack>
        <YStack gap={2} minW={120}>
          <Text fontSize="$6" fontWeight="700" color="$color12">{fmtContext(g.maxContext)}</Text>
          <Text fontSize="$1" color="$color10">Max context</Text>
        </YStack>
        <YStack gap={2} minW={120}>
          <Text fontSize="$6" fontWeight="700" color="$color12">{fmtPrice(g.minInput)}</Text>
          <Text fontSize="$1" color="$color10">From / Mtok</Text>
        </YStack>
        <YStack gap={2} minW={120}>
          <Text fontSize="$6" fontWeight="700" color="$color12">{String(availableCount)}</Text>
          <Text fontSize="$1" color="$color10">Available now</Text>
        </YStack>
      </XStack>

      <YStack gap={0} rounded="$4" borderWidth={1} borderColor="$borderColor" overflow="hidden">
        <XStack px="$3" py="$2" bg="$color2" gap="$3">
          <Text flex={1} fontSize="$1" color="$color10">MODEL</Text>
          <Text width={90} fontSize="$1" color="$color10">TYPE</Text>
          <Text width={80} fontSize="$1" color="$color10">CONTEXT</Text>
          <Text width={90} fontSize="$1" color="$color10">IN / OUT $</Text>
          <Text width={90} fontSize="$1" color="$color10">STATUS</Text>
        </XStack>
        {g.models.map((m) => (
          <XStack key={m.name} px="$3" py="$2.5" gap="$3" borderTopWidth={1} borderColor="$borderColor" items="center">
            <YStack flex={1} gap={1}>
              <Text fontSize="$3" color="$color12" numberOfLines={1}>{m.name}</Text>
              {m.description ? <Text fontSize="$1" color="$color10" numberOfLines={1}>{m.description}</Text> : null}
            </YStack>
            <Text width={90} fontSize="$2" color="$color11">{modelType(m)}</Text>
            <Text width={80} fontSize="$2" color="$color11">{fmtContext(m.context)}</Text>
            <Text width={90} fontSize="$2" color="$color11">{fmtPrice(m.pricing?.input)} / {fmtPrice(m.pricing?.output)}</Text>
            <Text width={90} fontSize="$1" color={m.available ? '$green11' : '$color10'}>
              {m.available ? '● Available' : 'Catalog'}
            </Text>
          </XStack>
        ))}
      </YStack>
    </YStack>
  )
}

type LoadState =
  | { phase: 'loading' }
  | { phase: 'error'; err: ApiError }
  | { phase: 'ready'; groups: ProviderGroup[]; total: number; available: number }

export function ProvidersExplore({ onAddCustom }: { onAddCustom: () => void }) {
  const router = useRouter()
  const [state, setState] = useState<LoadState>({ phase: 'loading' })
  const [selected, setSelected] = useState<ProviderGroup | null>(null)

  const run = useCallback(() => {
    setState({ phase: 'loading' })
    fetchCatalog()
      .then((models) =>
        setState({
          phase: 'ready',
          groups: groupByProvider(models),
          total: models.length,
          available: models.filter((m) => m.available).length,
        }),
      )
      .catch((e) => setState({ phase: 'error', err: asApiError(e) }))
  }, [])

  useEffect(() => {
    run()
  }, [run])

  const docsUrl = 'https://docs.hanzo.ai'
  const groups = state.phase === 'ready' ? state.groups : []
  const verified = useMemo(() => groups.length, [groups])

  // Click-through provider detail — metadata + the provider's model list.
  if (selected) {
    return <ProviderDetailPanel g={selected} onBack={() => setSelected(null)} />
  }

  return (
    <>
      <PageHeader
        title="Providers"
        subtitle="Explore AI model providers, deploy custom models, or bring your own weights."
        actions={
          <Button size="$2" icon={<Plus size={15} />} onPress={onAddCustom}>
            Add custom
          </Button>
        }
      />

      <XStack gap="$3" flexWrap="wrap">
        <ActionCard
          icon={<Boxes size={18} />}
          title="Deploy custom models"
          body="Configure and deploy models from any provider in seconds."
          cta="Create custom model"
          onPress={onAddCustom}
        />
        <ActionCard
          icon={<Upload size={18} />}
          title="Bring your own weights"
          body="Upload your model weights and deploy securely on Hanzo."
          cta="Upload weights"
          onPress={onAddCustom}
        />
        <ActionCard
          icon={<Code2 size={18} />}
          title="Build with APIs"
          body="Access providers using our unified API and SDK."
          cta="View docs"
          onPress={() => typeof window !== 'undefined' && window.open(docsUrl, '_blank', 'noopener')}
        />
      </XStack>

      {state.phase === 'error' ? (
        <ErrorState err={state.err} onRetry={run} />
      ) : state.phase === 'loading' ? (
        <Loader label="Loading providers…" />
      ) : (
        <>
          <XStack gap="$3" flexWrap="wrap">
            {groups.map((g) => (
              <ProviderCard key={g.provider} g={g} onOpen={() => setSelected(g)} />
            ))}
          </XStack>

          <XStack
            rounded="$4"
            borderWidth={1}
            borderColor="$borderColor"
            bg="$color1"
            mt="$2"
            flexWrap="wrap"
          >
            <Stat label="Providers" value={String(verified)} />
            <Stat label="Total models" value={String(state.total)} />
            <Stat label="Available now" value={String(state.available)} />
          </XStack>
        </>
      )}
    </>
  )
}
