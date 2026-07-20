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
 * measured on someone else's harness at someone else's effort setting. Collapsing
 * those into one "score" column without provenance would be quietly dishonest, so the
 * source rides along and `hanzo-measured` is badged.
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
  leaderboard,
  vendors,
  type Ranked,
} from '~/lib/api/benchmarks'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { ProviderLogo } from '~/components/ui/ProviderLogo'
import { PageHeader } from '~/components/ui/PageHeader'

const TNUM = 'hz-tnum'

const ALL = '__all__'

/** The default benchmark: the one the corpus covers most broadly. */
const defaultBenchmark = (): string =>
  BENCHMARK_IDS.slice().sort((a, b) => coverage(b) - coverage(a))[0] ?? BENCHMARK_IDS[0] ?? ''

/** A quiet chip. `tone="measured"` marks our own harness — the number we trust most. */
function Chip({ label, tone = 'muted' }: { label: string; tone?: 'muted' | 'measured' }) {
  return (
    <Text
      fontSize="$1"
      px="$2"
      py="$1"
      rounded="$2"
      bg={tone === 'measured' ? '$green3' : '$color3'}
      color={tone === 'measured' ? '$green11' : '$color11'}
      numberOfLines={1}
    >
      {label}
    </Text>
  )
}

/** A horizontally scrolling row of selector pills (benchmarks, vendors). */
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

export function LeaderboardView() {
  const [benchmark, setBenchmark] = useState<string>(defaultBenchmark)
  const [vendor, setVendor] = useState<string>(ALL)

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
    () => (vendor === ALL ? ranked : ranked.filter((r) => r.vendor === vendor)),
    [ranked, vendor],
  )

  const vendorOptions = useMemo(
    () => [{ key: ALL, label: 'All vendors' }, ...vendors().map((v) => ({ key: v, label: v }))],
    [],
  )

  const measured = rows.filter((r) => r.score.source === 'hanzo-measured').length

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
        r.score.source === 'hanzo-measured' ? (
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
        subtitle="Published benchmark scores from the enso-bench prior corpus. Every score carries its source; models without a published score on the selected benchmark are not listed."
      />

      <YStack gap="$2">
        <Text fontSize="$1" color="$color10">
          Benchmark
        </Text>
        <PillRow options={benchOptions} value={benchmark} onSelect={setBenchmark} />
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
          vendor === ALL
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
