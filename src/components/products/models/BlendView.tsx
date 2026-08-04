'use client'

/**
 * Blend — the org's own enabled-model set, and the Enso tiers that form over it.
 *
 * WHAT AN ORG IS ACTUALLY CHOOSING. Enso's flash/blend/ultra tiers are not fixed
 * rosters; they are PRICE BANDS over whatever models the org has enabled. So turning a
 * model on or off here re-forms the org's tiers, and the tier preview below shows that
 * happening live. The rules are the reference semantics from hanzoai/enso-bench
 * `harness/arms.py` (`resolve_blend`), ported in `~/lib/models/blend.ts` and pinned by
 * its unit tests — the console must mean exactly what the router means by "enabled".
 *
 * The three operators, in order: an `enable` ALLOWLIST (absent = inherit the whole
 * catalog, which is NOT the same as an empty allowlist), a `disable` DENYLIST applied
 * after it, then `add` for models the org brings itself. An org inheriting the catalog
 * that switches ONE model off records a denylist entry and KEEPS inheriting, so it
 * still receives models added to the catalog later.
 *
 * HONESTY ABOUT PERSISTENCE. The gateway does not yet store the blend columns (see the
 * TODO in `~/lib/api/org-blend.ts` naming the required fields on the existing
 * `/v1/org/settings` GET + PUT noun). The client writes them for real and then re-reads to
 * check they survived; when they did not, this view says the blend could not be saved
 * rather than showing a confirmation for a write the backend discarded.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Input, Text, XStack, YStack } from '@hanzo/gui'
import { Check, RefreshCw, RotateCcw, Save, Search, TriangleAlert } from '@hanzogui/lucide-icons-2'

import {
  fetchCatalog,
  fmtContext,
  fmtPrice,
  modelContext,
  modelId,
  supportsVision,
  toBlendModel,
  type CatalogEntry,
} from '~/lib/api/aicatalog'
import { priorFor } from '~/lib/api/benchmarks'
import { OrgBlendApi, type BlendState } from '~/lib/api/org-blend'
import {
  blendedPrice,
  emptyTiers,
  INHERIT_ALL,
  isEnabled,
  resolveBlend,
  setEnabled,
  TIER_LABEL,
  TIERS,
  tierMembers,
  toggle,
  type BlendSpec,
} from '~/lib/models/blend'
import { currentOrg } from '~/lib/org-scope'
import { ProviderLogo } from '~/components/ui/ProviderLogo'
import { PageHeader } from '~/components/ui/PageHeader'
import { PrimaryButton } from '~/components/ui/PrimaryButton'
import { ErrorState, asApiError } from '~/components/ui/States'
import type { ApiError } from '~/lib/api'

const TNUM = 'tnum'

type Load =
  | { phase: 'loading' }
  | { phase: 'error'; err: ApiError }
  | { phase: 'ready'; models: CatalogEntry[] }

/** A quiet notice band — used for both the persistence warning and the tier warning. */
function Notice({ tone, title, body }: { tone: 'warn' | 'info'; title: string; body: string }) {
  return (
    <XStack
      gap="$2.5"
      p="$3"
      rounded="$4"
      borderWidth={1}
      borderColor="$borderColor"
      bg={tone === 'warn' ? '$yellow2' : '$color2'}
      items="flex-start"
    >
      <TriangleAlert size={16} />
      <YStack flex={1} minW={0} gap={2}>
        <Text fontSize="$3" fontWeight="700" color="$color12">
          {title}
        </Text>
        <Text fontSize="$2" color="$color11">
          {body}
        </Text>
      </YStack>
    </XStack>
  )
}

/** One tier's live membership — recomputed from the blend on every toggle. */
function TierCard({ tier, members }: { tier: (typeof TIERS)[number]; members: string[] }) {
  return (
    <YStack
      flex={1}
      minW={190}
      gap="$1.5"
      p="$3"
      rounded="$4"
      borderWidth={1}
      borderColor={members.length === 0 ? '$yellow7' : '$borderColor'}
      bg="$color1"
    >
      <Text fontSize="$3" fontWeight="700" color="$color12">
        {TIER_LABEL[tier]}
      </Text>
      <Text className={TNUM} fontSize="$6" fontWeight="800" color={members.length === 0 ? '$yellow11' : '$color12'}>
        {members.length}
      </Text>
      <Text fontSize="$1" color="$color10" numberOfLines={2}>
        {members.length === 0 ? 'No model in this band' : members.slice(0, 3).join(' · ')}
      </Text>
    </YStack>
  )
}

/** One catalog model with its enable switch and everything the choice depends on. */
function BlendRow({
  m,
  enabled,
  onToggle,
}: {
  m: CatalogEntry
  enabled: boolean
  onToggle: () => void
}) {
  const id = modelId(m)
  const bm = toBlendModel(m)
  const blended = blendedPrice(bm)
  const prior = priorFor(id)
  // The single headline score the corpus already computed for this model, if any.
  const best = prior?.intelligence ?? null

  return (
    <XStack
      items="center"
      gap="$2.5"
      px="$3"
      py="$2.5"
      borderTopWidth={1}
      borderColor="$borderColor"
      opacity={enabled ? 1 : 0.55}
    >
      <Button
        size="$2"
        circular
        bg={enabled ? '$green5' : 'transparent'}
        borderWidth={1}
        borderColor={enabled ? '$green8' : '$borderColor'}
        onPress={onToggle}
        aria-label={`${enabled ? 'Disable' : 'Enable'} ${bm.name ?? id}`}
        icon={enabled ? <Check size={14} /> : undefined}
      />
      <ProviderLogo provider={bm.vendor ?? 'Other'} model={id} size={24} />
      <YStack flex={1} minW={0} gap={1}>
        <Text fontSize="$3" color="$color12" numberOfLines={1}>
          {bm.name || id}
        </Text>
        <Text fontSize="$1" color="$color10" numberOfLines={1}>
          {bm.vendor}
        </Text>
      </YStack>

      {/* Vision capability — from the catalog's own features, blank when absent. */}
      <XStack width={54} justify="flex-end" display="none" $md={{ display: 'flex' }}>
        {supportsVision(m) ? (
          <Text fontSize="$1" px="$2" py="$1" rounded="$2" bg="$color3" color="$color11">
            Vision
          </Text>
        ) : null}
      </XStack>

      <Text className={TNUM} fontSize="$2" color="$color11" width={60} text="right" display="none" $md={{ display: 'flex' }}>
        {fmtContext(modelContext(m))}
      </Text>
      <Text className={TNUM} fontSize="$2" color="$color11" width={72} text="right" display="none" $md={{ display: 'flex' }}>
        {fmtPrice(m.pricing?.input)}/{fmtPrice(m.pricing?.output).replace('$', '')}
      </Text>
      <Text className={TNUM} fontSize="$2" color="$color12" width={64} text="right">
        {blended == null ? '—' : `$${blended.toFixed(2)}`}
      </Text>
      {/* Benchmark headline — an em-dash when the corpus has no score for this model. */}
      <Text className={TNUM} fontSize="$2" color={best == null ? '$color10' : '$color12'} width={52} text="right">
        {best == null ? '—' : best.toFixed(1)}
      </Text>
    </XStack>
  )
}

export function BlendView() {
  const org = currentOrg()
  const [load, setLoad] = useState<Load>({ phase: 'loading' })
  const [saved, setSaved] = useState<BlendState | null>(null)
  const [spec, setSpec] = useState<BlendSpec>(INHERIT_ALL)
  const [busy, setBusy] = useState(false)
  const [saveErr, setSaveErr] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const run = useCallback(() => {
    setLoad({ phase: 'loading' })
    fetchCatalog()
      .then((models) => setLoad({ phase: 'ready', models }))
      .catch((e) => setLoad({ phase: 'error', err: asApiError(e) }))
    // The org's stored blend is ENRICHMENT: if it cannot be read we still render the
    // catalog with the inherit-everything default, which is the true starting state.
    OrgBlendApi.get(org)
      .then((s) => {
        setSaved(s)
        setSpec(s.spec)
      })
      .catch(() => setSaved({ spec: INHERIT_ALL, persisted: false }))
  }, [org])

  useEffect(() => run(), [run])

  const models = load.phase === 'ready' ? load.models : []
  const catalog = useMemo(() => models.map(toBlendModel), [models])
  const blend = useMemo(() => resolveBlend(catalog, spec), [catalog, spec])
  const missing = useMemo(() => emptyTiers(blend), [blend])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return models
    return models.filter((m) => `${modelId(m)} ${m.name ?? ''} ${m.provider ?? ''}`.toLowerCase().includes(q))
  }, [models, query])

  const dirty = useMemo(() => JSON.stringify(spec) !== JSON.stringify(saved?.spec ?? INHERIT_ALL), [spec, saved])

  const save = async () => {
    setBusy(true)
    setSaveErr(null)
    try {
      const next = await OrgBlendApi.save(org, spec)
      setSaved(next)
      if (!next.persisted) {
        setSaveErr(
          'The gateway accepted the write but did not store the blend — the OrgSettings row does not carry the model columns yet. Your selection is applied in this session only.',
        )
      }
    } catch (e) {
      setSaveErr(asApiError(e).message || 'Could not save the blend.')
    } finally {
      setBusy(false)
    }
  }

  if (load.phase === 'error') return <ErrorState err={load.err} onRetry={run} />

  const enabledCount = blend.length

  return (
    <YStack gap="$3.5">
      <PageHeader
        title="Blend"
        subtitle={`The models ${org} routes over. Enso's flash, blend, and ultra tiers are price bands over this set — change what is enabled and the tiers re-form.`}
        actions={
          <>
            <Button size="$2" icon={<RefreshCw size={15} />} onPress={run} disabled={busy}>
              Reload
            </Button>
            <Button
              size="$2"
              icon={<RotateCcw size={15} />}
              onPress={() => setSpec(INHERIT_ALL)}
              disabled={busy || (spec.enable === null && spec.disable.length === 0)}
            >
              Inherit all
            </Button>
            <PrimaryButton size="$2" icon={<Save size={15} />} onPress={save} disabled={busy || !dirty}>
              {busy ? 'Saving…' : 'Save blend'}
            </PrimaryButton>
          </>
        }
      />

      {saved && !saved.persisted ? (
        <Notice
          tone="warn"
          title="Blend storage is not live yet"
          body="This org has no stored blend: the gateway's OrgSettings row does not yet carry the enabledModels / disabledModels / customModels columns. Selections below are real and drive the tier preview, but they will not persist until that lands."
        />
      ) : null}

      {saveErr ? <Notice tone="warn" title="Not saved" body={saveErr} /> : null}

      {missing.length > 0 && enabledCount > 0 ? (
        <Notice
          tone="warn"
          title={`No models in ${missing.map((t) => TIER_LABEL[t]).join(' and ')}`}
          body="A tier with no members has nothing to route to. Enable at least one model whose blended price falls in each band you intend to serve."
        />
      ) : null}

      {/* Tier preview — the consequence of the current selection, recomputed live. */}
      <XStack gap="$2.5" flexWrap="wrap">
        {TIERS.map((t) => (
          <TierCard key={t} tier={t} members={tierMembers(blend, t).map((m) => m.name || m.id)} />
        ))}
      </XStack>

      <XStack gap="$2" items="center" flexWrap="wrap">
        <XStack flex={1} minW={200} items="center" gap="$2" px="$2.5" borderWidth={1} borderColor="$borderColor" rounded="$3">
          <Search size={15} />
          <Input flex={1} unstyled placeholder="Filter models" value={query} onChangeText={setQuery} py="$2" />
        </XStack>
        <Button size="$2" onPress={() => setSpec(setEnabled(visible.map(modelId), spec))} disabled={visible.length === 0}>
          Enable shown
        </Button>
        <Text className={TNUM} fontSize="$2" color="$color11">
          {enabledCount} of {catalog.length} enabled
        </Text>
      </XStack>

      <YStack borderWidth={1} borderColor="$borderColor" rounded="$4" overflow="hidden" bg="$color1">
        <XStack px="$3" py="$2.5" gap="$2.5" bg="$color1" items="center">
          <YStack width={34} />
          <Text fontSize="$1" color="$color10" flex={1}>
            Model
          </Text>
          <Text fontSize="$1" color="$color10" width={54} text="right" display="none" $md={{ display: 'flex' }}>
            Input
          </Text>
          <Text fontSize="$1" color="$color10" width={60} text="right" display="none" $md={{ display: 'flex' }}>
            Context
          </Text>
          <Text fontSize="$1" color="$color10" width={72} text="right" display="none" $md={{ display: 'flex' }}>
            In/Out $/M
          </Text>
          <Text fontSize="$1" color="$color10" width={64} text="right">
            Blended
          </Text>
          <Text fontSize="$1" color="$color10" width={52} text="right">
            Bench
          </Text>
        </XStack>

        {load.phase === 'loading' ? (
          <YStack p="$4">
            <Text fontSize="$2" color="$color10">
              Loading the live catalog…
            </Text>
          </YStack>
        ) : visible.length === 0 ? (
          <YStack p="$4">
            <Text fontSize="$2" color="$color10">
              {models.length === 0
                ? 'The gateway returned no models. Nothing is shown rather than a placeholder catalog.'
                : 'No model matches that filter.'}
            </Text>
          </YStack>
        ) : (
          visible.map((m) => {
            const id = modelId(m)
            return (
              <BlendRow
                key={id}
                m={m}
                enabled={isEnabled(id, spec)}
                onToggle={() => setSpec((s) => toggle(id, !isEnabled(id, s), s))}
              />
            )
          })
        )}
      </YStack>

      <Text fontSize="$1" color="$color10">
        Blended $/MTok = 0.2·input + 0.8·output, the output-dominant weighting the Enso router ranks on. Bench is the
        best published score for the model in the enso-bench corpus; an em-dash means no published score.
      </Text>
    </YStack>
  )
}
