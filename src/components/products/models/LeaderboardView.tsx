'use client'

/**
 * Leaderboard — the published benchmark corpus, ranked by the benchmark you pick.
 *
 * Source: the enso-bench prior corpus, imported at BUILD TIME (`~/lib/api/benchmarks`
 * — see that file for why a fixture rather than an endpoint). So this view has no
 * loading state and no failure mode: the data is in the bundle.
 *
 * Every row shows the score AND ITS SOURCE, because they are not the same kind of
 * number: `hanzo-measured` is our own harness through api.hanzo.ai (what the router
 * actually gets), while the provider- and third-party-reported figures are context
 * measured on someone else's harness at someone else's effort setting. The Source
 * toggle filters the two apart — the honest transparency this surface exists for —
 * and every row is badged by its class (Enso · Hanzo-measured · reported).
 *
 * The Enso family (enso-flash / enso / enso-ultra) is our own product; it ranks in
 * the table on merit like every other model — never floated to the top — and the
 * tier strip above places the three tiers side by side, monotonic and priced, from
 * the same corpus numbers.
 *
 * Models with no published score on the selected benchmark are OMITTED, never shown
 * as zero — an absent measurement is not a bad measurement.
 */
import { useMemo, useState } from 'react'
import { Button, Text, XStack, YStack } from '@hanzo/gui'
import { Trophy } from '@hanzogui/lucide-icons-2'

import {
  BENCHMARK_IDS,
  benchmarkLabel,
  coverage,
  isEnsoModel,
  leaderboard,
  priorFor,
  sourceClass,
  vendors,
  type Ranked,
  type SourceClass,
} from '~/lib/api/benchmarks'
import { DataTable, type Column } from '@hanzo/ui/product'
import { ProviderLogo } from '~/components/ui/ProviderLogo'
import { PageHeader } from '@hanzo/ui/product'

const TNUM = 'hz-tnum'

const ALL = '__all__'

/** The Source filter: all rows, only our harness, or only vendor/third-party. */
type SrcFilter = 'all' | SourceClass
const SRC_OPTIONS: { key: SrcFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'measured', label: 'Hanzo-measured' },
  { key: 'reported', label: 'Vendor-reported' },
]

/** The default benchmark: the one the corpus covers most broadly. */
const defaultBenchmark = (): string =>
  BENCHMARK_IDS.slice().sort((a, b) => coverage(b) - coverage(a))[0] ?? BENCHMARK_IDS[0] ?? ''

/**
 * A quiet class chip. `enso` marks our own orchestrated family (Hanzo red),
 * `measured` marks our own harness (green) — the numbers we trust most — and
 * `muted` carries a reported source string verbatim.
 */
function Chip({ label, tone = 'muted' }: { label: string; tone?: 'muted' | 'measured' | 'enso' }) {
  const bg = tone === 'enso' ? '$red3' : tone === 'measured' ? '$green3' : '$color3'
  const color = tone === 'enso' ? '$red11' : tone === 'measured' ? '$green11' : '$color11'
  return (
    <Text fontSize="$1" px="$2" py="$1" rounded="$2" bg={bg} color={color} numberOfLines={1}>
      {label}
    </Text>
  )
}

/** A horizontally scrolling row of selector pills (benchmarks, vendors, source). */
function PillRow({
  options,
  value,
  onSelect,
}: {
  options: { key: string; label: string; hint?: string }[]
  value: string
  onSelect: (key: string) => void
}) {
  return (
    <YStack style={{ overflowX: 'auto' }}>
      <XStack gap="$1.5" py="$1">
        {options.map((o) => (
          <Button
            key={o.key}
            size="$2"
            bg={o.key === value ? '$color5' : 'transparent'}
            borderWidth={1}
            borderColor="$borderColor"
            onPress={() => onSelect(o.key)}
          >
            {o.hint ? `${o.label} · ${o.hint}` : o.label}
          </Button>
        ))}
      </XStack>
    </YStack>
  )
}

/**
 * The three Enso tiers, side by side and monotonic in quality (Ultra > Pro > Flash),
 * priced. Every number is read from the SAME corpus the table ranks on — no separate
 * marketing figures — so the strip renders only when all three tiers carry a
 * GPQA-Diamond score (they do once the enso family is synced in). Pro is marked as the
 * balanced default. An honest surface: no projected numbers, no fabricated #1.
 */
const ENSO_TIERS: { id: string; name: string; note: string; isDefault?: boolean }[] = [
  { id: 'enso-flash', name: 'Enso Flash', note: 'Cheapest — high-volume, escalate only if needed' },
  { id: 'enso', name: 'Enso Pro', note: 'The balanced default — routed to the best-fit model per request', isDefault: true },
  { id: 'enso-ultra', name: 'Enso Ultra', note: 'Maximum verified quality — adaptive fan-out on the hardest problems' },
]

function EnsoTiers({ benchmark }: { benchmark: string }) {
  // Prefer the selected benchmark; fall back to GPQA-Diamond (the tiers' shared
  // headline) so the strip is populated even when the table is on another benchmark.
  const tiers = ENSO_TIERS.map((t) => {
    const prior = priorFor(t.id)
    const score = prior?.scores[benchmark] ?? prior?.scores.gpqa_diamond ?? null
    const bench = prior?.scores[benchmark] ? benchmark : 'gpqa_diamond'
    return { ...t, score, benchLabel: benchmarkLabel(bench), price: prior?.price ?? null }
  })
  // Honest: only render if the corpus actually carries the family (post-sync).
  if (tiers.some((t) => t.score == null)) return null

  return (
    <YStack gap="$2">
      <Text fontSize="$1" color="$color10">
        The Enso tiers — one price/quality contract each, from the corpus below
      </Text>
      <XStack gap="$2.5" flexWrap="wrap">
        {tiers.map((t) => (
          <YStack
            key={t.id}
            flex={1}
            minW={190}
            gap="$1.5"
            p="$3"
            rounded="$4"
            borderWidth={1}
            borderColor={t.isDefault ? '$red7' : '$borderColor'}
            bg="$color1"
          >
            <XStack items="center" gap="$2" justify="space-between">
              <Text fontSize="$3" fontWeight="700" color="$color12">
                {t.name}
              </Text>
              {t.isDefault ? <Chip label="default" tone="enso" /> : null}
            </XStack>
            <XStack items="baseline" gap="$2">
              <Text className={TNUM} fontSize="$7" fontWeight="800" color="$color12">
                {t.score!.value.toFixed(1)}
              </Text>
              <Text fontSize="$1" color="$color10">
                {t.benchLabel}
              </Text>
            </XStack>
            <XStack items="center" gap="$2" flexWrap="wrap">
              <Text className={TNUM} fontSize="$2" color="$color11">
                {t.price == null ? '—' : `$${t.price.toFixed(2)}/M blended`}
              </Text>
              <Chip label="Hanzo-measured" tone="measured" />
            </XStack>
            <Text fontSize="$1" color="$color10" numberOfLines={2}>
              {t.note}
            </Text>
          </YStack>
        ))}
      </XStack>
    </YStack>
  )
}

export function LeaderboardView() {
  const [benchmark, setBenchmark] = useState<string>(defaultBenchmark)
  const [vendor, setVendor] = useState<string>(ALL)
  const [src, setSrc] = useState<SrcFilter>('all')

  // Only offer benchmarks the corpus actually covers — a benchmark with zero scored
  // models is not a view worth selecting.
  const benchOptions = useMemo(
    () =>
      BENCHMARK_IDS.filter((id) => coverage(id) > 0).map((id) => ({
        key: id,
        label: benchmarkLabel(id),
        hint: String(coverage(id)),
      })),
    [],
  )

  const ranked = useMemo(() => leaderboard(benchmark), [benchmark])
  const rows = useMemo(
    () =>
      ranked.filter(
        (r) =>
          (vendor === ALL || r.vendor === vendor) &&
          (src === 'all' || sourceClass(r.score.source) === src),
      ),
    [ranked, vendor, src],
  )

  const vendorOptions = useMemo(
    () => [{ key: ALL, label: 'All vendors' }, ...vendors().map((v) => ({ key: v, label: v }))],
    [],
  )

  const measured = rows.filter((r) => sourceClass(r.score.source) === 'measured').length

  const columns: Column<Ranked>[] = [
    {
      key: 'rank',
      header: '#',
      width: 44,
      align: 'right',
      mono: true,
      render: (r) => (
        <Text className={TNUM} fontSize="$2" color="$color10">
          {r.rank}
        </Text>
      ),
    },
    {
      key: 'model',
      header: 'Model',
      render: (r) => (
        <XStack items="center" gap="$2.5" minW={0}>
          <ProviderLogo provider={r.vendor} model={r.model} size={24} />
          <Text fontSize="$3" color="$color12" numberOfLines={1}>
            {r.model}
          </Text>
          {isEnsoModel(r.model) ? <Chip label="Enso" tone="enso" /> : null}
        </XStack>
      ),
    },
    {
      key: 'vendor',
      header: 'Vendor',
      width: 110,
      render: (r) => (
        <Text fontSize="$2" color="$color11" numberOfLines={1}>
          {r.vendor}
        </Text>
      ),
    },
    {
      key: 'score',
      header: benchmarkLabel(benchmark),
      width: 96,
      align: 'right',
      mono: true,
      render: (r) => (
        <Text className={TNUM} fontSize="$3" fontWeight="700" color="$color12">
          {r.score.value.toFixed(1)}
        </Text>
      ),
    },
    {
      key: 'source',
      header: 'Source',
      width: 190,
      render: (r) =>
        isEnsoModel(r.model) ? (
          <Chip label="Enso · measured" tone="enso" />
        ) : sourceClass(r.score.source) === 'measured' ? (
          <Chip label="Hanzo-measured" tone="measured" />
        ) : (
          <Text fontSize="$1" color="$color10" numberOfLines={1}>
            {r.score.source}
          </Text>
        ),
    },
    {
      key: 'price',
      header: 'Blended $/M',
      width: 104,
      align: 'right',
      mono: true,
      render: (r) => (
        <Text className={TNUM} fontSize="$2" color={r.price == null ? '$color10' : '$color11'}>
          {r.price == null ? '—' : `$${r.price.toFixed(2)}`}
        </Text>
      ),
    },
  ]

  return (
    <YStack gap="$3.5">
      <PageHeader
        title="Leaderboard"
        subtitle="Published benchmark scores from the enso-bench prior corpus. Vendors report on their own harness; we measure everyone on one — toggle Source to see which is which. Models without a published score on the selected benchmark are not listed."
      />

      <EnsoTiers benchmark={benchmark} />

      <YStack gap="$2">
        <Text fontSize="$1" color="$color10">
          Benchmark
        </Text>
        <PillRow options={benchOptions} value={benchmark} onSelect={setBenchmark} />
      </YStack>

      <YStack gap="$2">
        <Text fontSize="$1" color="$color10">
          Source
        </Text>
        <PillRow options={SRC_OPTIONS} value={src} onSelect={(k) => setSrc(k as SrcFilter)} />
      </YStack>

      <YStack gap="$2">
        <Text fontSize="$1" color="$color10">
          Vendor
        </Text>
        <PillRow options={vendorOptions} value={vendor} onSelect={setVendor} />
      </YStack>

      <XStack gap="$2" items="center" flexWrap="wrap">
        <Trophy size={14} />
        <Text className={TNUM} fontSize="$2" color="$color11">
          {rows.length} scored model{rows.length === 1 ? '' : 's'}
          {measured > 0 ? ` · ${measured} on our own harness` : ''}
        </Text>
      </XStack>

      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(r) => r.model}
        empty={
          src === 'measured'
            ? `No Hanzo-measured ${benchmarkLabel(benchmark)} score${vendor === ALL ? '' : ` for ${vendor}`} in the corpus.`
            : src === 'reported'
              ? `No vendor-reported ${benchmarkLabel(benchmark)} score${vendor === ALL ? '' : ` for ${vendor}`} in the corpus.`
              : vendor === ALL
                ? `No published scores for ${benchmarkLabel(benchmark)} in the corpus.`
                : `No ${vendor} model has a published ${benchmarkLabel(benchmark)} score in the corpus.`
        }
      />

      <Text fontSize="$1" color="$color10">
        Corpus: hanzoai/enso-bench priors/leaderboard.json. Regenerate with{' '}
        <Text fontSize="$1" color="$color11" className="hz-mono">
          node scripts/sync-benchmarks.mjs
        </Text>
        .
      </Text>
    </YStack>
  )
}
