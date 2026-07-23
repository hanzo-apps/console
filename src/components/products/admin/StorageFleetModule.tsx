/**
 * Block Storage — the GLOBAL-ADMIN realtime view of our DO block-storage fleet, so we
 * can watch the analytics datastore (and every volume) fill and SCALE DO storage before
 * it runs out. admin.hanzo.ai only. One read: `StorageFleetApi.snapshot()` →
 * `GET /v1/admin/storage` (the gated aggregate BFF). Honest by construction — a volume's
 * fill % renders only when a filesystem source reported it (DO's API gives capacity, not
 * fill), never a fabricated number.
 */
'use client'
import { useCallback, useEffect, useState } from 'react'
import { Card, Text, XStack, YStack } from '@hanzo/gui'
import { HardDrive, Database, TriangleAlert, RefreshCw, Server, Gauge, DollarSign } from '@hanzogui/lucide-icons-2'

import { ApiError } from '~/lib/api'
import { StorageFleetApi, type StorageSnapshot, type StorageVolume } from '~/lib/api/storage-fleet'
import { PageHeader } from '~/components/ui/PageHeader'
import { MetricCard } from '~/components/ui/Metric'
import { DataTable, type Column } from '~/components/ui/DataTable'
import { ErrorState, asApiError, isForbidden, OperatorAccessRequired } from '~/components/ui/States'

// ── helpers ───────────────────────────────────────────────────────────────────

/** GiB → a readable size (GiB under 1024, else TiB). */
function fmtSize(gib: number): string {
  return gib >= 1024 ? `${(gib / 1024).toFixed(gib % 1024 === 0 ? 0 : 1)} TiB` : `${gib} GiB`
}

/** Fill urgency: green < 70%, amber < 85%, red ≥ 85% — so a near-full volume is loud. */
function fillColor(pct: number | null): `#${string}` {
  if (pct == null) return '#3a3a3a'
  if (pct >= 85) return '#e5534b'
  if (pct >= 70) return '#ff9f45'
  return '#23c562'
}

/** A usage bar — filled portion colored by urgency; a null fill renders an empty track + "—". */
function FillBar({ pct }: { pct: number | null }) {
  const w = pct == null ? 0 : Math.max(2, Math.min(100, pct))
  return (
    <XStack items="center" gap="$2" flex={1} minW={120}>
      <XStack flex={1} height={6} rounded="$10" style={{ backgroundColor: 'rgba(148,163,184,0.16)', overflow: 'hidden' }}>
        <XStack style={{ width: `${w}%`, backgroundColor: fillColor(pct) }} height={6} rounded="$10" />
      </XStack>
      <Text className="hz-mono" fontSize="$1" color="$color11" style={{ minWidth: 42, textAlign: 'right' }}>
        {pct == null ? '—' : `${pct.toFixed(0)}%`}
      </Text>
    </XStack>
  )
}

// ── module ────────────────────────────────────────────────────────────────────

export function StorageFleetModule() {
  const [snap, setSnap] = useState<StorageSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<ApiError | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      setSnap(await StorageFleetApi.snapshot())
    } catch (e) {
      setErr(asApiError(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const t = setInterval(() => void load(), 30_000) // realtime-ish: re-poll every 30s
    return () => clearInterval(t)
  }, [load])

  const header = (
    <PageHeader
      title="Block Storage"
      subtitle="DO block-storage fleet — watch the analytics datastore fill and scale before it runs out."
      actions={
        <XStack
          items="center"
          gap="$1.5"
          px="$3"
          py="$2"
          rounded="$4"
          borderWidth={1}
          borderColor="$borderColor"
          pressStyle={{ opacity: 0.7 }}
          cursor="pointer"
          onPress={() => void load()}
        >
          <RefreshCw size={14} color="$color11" />
          <Text fontSize="$2" color="$color11">Refresh</Text>
        </XStack>
      }
    />
  )

  if (err) {
    return (
      <YStack gap="$5" p="$5">
        {header}
        {isForbidden(err) ? <OperatorAccessRequired /> : <ErrorState err={err} onRetry={() => void load()} />}
      </YStack>
    )
  }

  const s = snap
  const d = s?.datastore ?? null
  // Fullest-first, then largest — the volume about to fill is at the top.
  const volumes = (s?.volumes ?? []).slice().sort((a, b) => (b.pct ?? -1) - (a.pct ?? -1) || b.sizeGiB - a.sizeGiB)

  const columns: Column<StorageVolume>[] = [
    { key: 'name', header: 'Volume', render: (v) => <Text fontSize="$2" color="$color12" numberOfLines={1}>{v.service || v.name}</Text> },
    { key: 'region', header: 'Region', render: (v) => <Text fontSize="$2" color="$color10">{v.region || '—'}</Text> },
    { key: 'size', header: 'Capacity', render: (v) => <Text className="hz-mono" fontSize="$2" color="$color11">{fmtSize(v.sizeGiB)}</Text> },
    { key: 'fill', header: 'Used', render: (v) => <FillBar pct={v.pct} /> },
    { key: 'attached', header: 'Attached', render: (v) => <Text fontSize="$1" color={v.attached ? '$color11' : '$color9'}>{v.attached ? 'yes' : 'unattached'}</Text> },
  ]

  return (
    <YStack gap="$5" p="$5">
      {header}

      {/* Fleet KPIs — real inventory + cost; used/fill only where a fs source reported it. */}
      <XStack gap="$3" flexWrap="wrap">
        <MetricCard icon={<Server size={15} />} label="Volumes" value={s ? String(s.fleet.count) : '—'} caption="DO block volumes" />
        <MetricCard icon={<HardDrive size={15} />} label="Provisioned" value={s ? fmtSize(s.fleet.totalGiB) : '—'} caption="total capacity" />
        <MetricCard icon={<Gauge size={15} />} label="Used" value={s && s.fleet.usedGiB != null ? fmtSize(Math.round(s.fleet.usedGiB)) : '—'} caption={s && s.fleet.pct != null ? `${s.fleet.pct.toFixed(0)}% of fleet` : 'fill via o11y'} />
        <MetricCard icon={<DollarSign size={15} />} label="Fleet cost" value={s ? `$${s.fleet.monthlyUsd.toLocaleString()}` : '—'} caption="per month ($0.10/GiB)" />
      </XStack>

      {/* THE analytics datastore — highlighted, the volume we most need to watch. */}
      {d && (
        <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor" data-testid="datastore-card">
          <XStack items="center" justify="space-between" gap="$2" flexWrap="wrap">
            <XStack items="center" gap="$2" flex={1} minW={0}>
              <Database size={18} color="$color11" />
              <YStack minW={0}>
                <Text fontSize="$5" fontWeight="700" color="$color12">Analytics datastore</Text>
                <Text fontSize="$1" color="$color10" numberOfLines={1}>{d.name}{d.mount ? ` · ${d.mount}` : ''}</Text>
              </YStack>
            </XStack>
            <Text className="hz-mono" fontSize="$6" fontWeight="700" style={{ color: fillColor(d.pct) }}>
              {fmtSize(Math.round(d.usedGiB))} / {fmtSize(d.sizeGiB)}
            </Text>
          </XStack>
          <FillBar pct={d.pct} />
          {d.pct >= 70 && (
            <XStack items="center" gap="$1.5">
              <TriangleAlert size={14} color={fillColor(d.pct)} />
              <Text fontSize="$1" style={{ color: fillColor(d.pct) }}>
                {d.pct >= 85 ? 'Critical — scale this volume now.' : 'Filling — plan to scale soon.'}
              </Text>
            </XStack>
          )}
          {/* Scale affordance — do-block-storage supports online expand (patch the PVC). v1 shows the path; the resize action rides the platform. */}
          <Text fontSize="$1" color="$color9">
            To scale: `do-block-storage` supports online volume expansion — grow the PVC storage request and the volume + filesystem resize with no downtime.
          </Text>
        </Card>
      )}

      {/* Near-full alerts, if the backend flagged any. */}
      {s && s.alerts.length > 0 && (
        <Card p="$3" gap="$2" borderWidth={1} borderColor="$borderColor">
          <XStack items="center" gap="$1.5">
            <TriangleAlert size={15} color="#ff9f45" />
            <Text fontSize="$3" fontWeight="700" color="$color12">Near-full volumes</Text>
          </XStack>
          {s.alerts.map((a) => (
            <XStack key={a.volume} items="center" justify="space-between" gap="$2">
              <Text fontSize="$2" color="$color11" numberOfLines={1}>{a.volume}</Text>
              <Text className="hz-mono" fontSize="$2" style={{ color: fillColor(a.pct) }}>{a.pct.toFixed(0)}%</Text>
            </XStack>
          ))}
        </Card>
      )}

      {/* The full fleet, fullest-first. */}
      <DataTable<StorageVolume>
        columns={columns}
        rows={volumes}
        rowKey={(v) => v.id}
        loading={loading && !s}
        empty="No block-storage volumes reported."
      />
    </YStack>
  )
}
