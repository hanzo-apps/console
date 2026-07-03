'use client'

/**
 * Launch drawer — the ONE real launch flow for both Machines and GPUs (a GPU is just a
 * machine with a `gpu-*` size slug, so this is shared, DRY). Opened in the shared
 * right-side `DetailPane`. It loads the COMPLETE live catalog from visor
 * (`/vm/v1/sizes` for machines, `/vm/v1/gpus` for GPUs) + the real regions, shows OUR
 * market price ($/hr + $/mo — the same visor `HanzoPrice` the launch charges), and on
 * Launch calls the native `POST /v1/machines/launch` (visor-backed, per-org, Bearer-auth'd through the `/cloud` proxy).
 * The new machine flows back to the caller's list via `onLaunched`. Errors are honest:
 * a 402 / "insufficient balance" becomes an "add credits" prompt; nothing is fabricated.
 */
import { useEffect, useMemo, useState } from 'react'
import { Button, Card, Input, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { AlertTriangle, BookOpen, Check, Cpu, CreditCard, Rocket, Search, Server } from '@hanzogui/lucide-icons-2'

import { config } from '~/config'
import { ApiError } from '~/lib/api/client'
import {
  VisorApi,
  DASH,
  type LaunchInput,
  type VisorGpuSize,
  type VisorMachine,
  type VisorRegion,
  type VisorSize,
} from '~/lib/api/visor'
import { FieldSelect } from '~/components/ui/Field'

/** A catalog row unified over CPU sizes and GPU sizes (GPU carries model/count/VRAM). */
type Item = VisorSize & Partial<Pick<VisorGpuSize, 'model' | 'gpuCount' | 'vramGb'>>

const hr = (n?: number) => (n == null ? DASH : `$${n < 1 ? n.toFixed(3) : n.toFixed(2)}/hr`)
const mo = (n?: number) => (n == null ? DASH : `$${Math.round(n).toLocaleString()}/mo`)

function spec(it: Item): string {
  const host = [it.vcpus != null ? `${it.vcpus} vCPU` : null, it.memGb != null ? `${it.memGb} GB` : null].filter(Boolean).join(' · ')
  if (it.model) {
    const gpu = `${it.gpuCount && it.gpuCount > 1 ? `${it.gpuCount}× ` : ''}${it.model}${it.vramGb ? ` · ${it.vramGb} GB VRAM` : ''}`
    return host ? `${gpu} · ${host} host` : gpu
  }
  return host || DASH
}

export function LaunchDrawer({
  kind,
  onLaunched,
  onClose,
}: {
  kind: 'cpu' | 'gpu'
  onLaunched: (m: VisorMachine) => void
  onClose: () => void
}) {
  const [items, setItems] = useState<Item[]>([])
  const [regions, setRegions] = useState<VisorRegion[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<string>('') // selected size slug
  const [region, setRegion] = useState<string>('')
  const [name, setName] = useState('')
  const [phase, setPhase] = useState<'idle' | 'launching'>('idle')
  const [error, setError] = useState<{ msg: string; credits: boolean } | null>(null)

  useEffect(() => {
    let live = true
    Promise.allSettled([kind === 'gpu' ? VisorApi.gpus() : VisorApi.sizes(), VisorApi.regions()]).then(([c, r]) => {
      if (!live) return
      const cat = c.status === 'fulfilled' ? (c.value as Item[]).filter((x) => x.available) : []
      setItems(cat)
      const regs = r.status === 'fulfilled' ? r.value.filter((x) => x.available) : []
      setRegions(regs)
      setRegion((cur) => cur || regs[0]?.slug || '')
      setLoading(false)
    })
    return () => {
      live = false
    }
  }, [kind])

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    const rows = s ? items.filter((it) => `${it.slug} ${it.model ?? ''}`.toLowerCase().includes(s)) : items
    return rows.slice().sort((a, b) => (a.priceHourly ?? 0) - (b.priceHourly ?? 0))
  }, [items, q])

  const selected = useMemo(() => items.find((it) => it.slug === sel) ?? null, [items, sel])
  const regionOptions = regions.length ? regions.map((r) => r.slug) : ['nyc1']
  const canLaunch = !!selected && !!region && name.trim().length > 0 && phase === 'idle'

  const launch = async () => {
    if (!canLaunch || !selected) return
    setPhase('launching')
    setError(null)
    try {
      const input: LaunchInput = { size: selected.slug, region, name: name.trim() }
      const m = await VisorApi.launch(input)
      onLaunched(m)
    } catch (e) {
      const status = e instanceof ApiError ? e.status : undefined
      const msg = e instanceof Error ? e.message : String(e)
      const credits = status === 402 || /insufficient|balance|credit|payment/i.test(msg)
      setError({ msg: credits ? 'Insufficient balance — add credits to launch this machine.' : msg, credits })
      setPhase('idle')
    }
  }

  if (loading) {
    return (
      <XStack p="$6" justify="center">
        <Spinner size="large" color="$color11" />
      </XStack>
    )
  }

  return (
    <YStack gap="$3">
      <Text fontSize="$2" color="$color11">
        {kind === 'gpu'
          ? 'Launch a dedicated GPU machine. Pick an accelerator and region — you pay the per-hour rate, metered to your Hanzo balance.'
          : 'Launch a dedicated compute machine. Pick a size and region — you pay the per-hour rate, metered to your Hanzo balance.'}
      </Text>

      {/* Name */}
      <YStack gap="$1.5">
        <Text fontSize="$2" color="$color11" fontWeight="600">Name</Text>
        <Input value={name} onChangeText={setName} placeholder={kind === 'gpu' ? 'my-gpu-box' : 'my-machine'} autoCapitalize="none" />
      </YStack>

      {/* Type picker — the COMPLETE live catalog, searchable */}
      <YStack gap="$1.5">
        <XStack items="center" justify="space-between">
          <Text fontSize="$2" color="$color11" fontWeight="600">{kind === 'gpu' ? 'GPU type' : 'Size'}</Text>
          <Text fontSize="$1" color="$color10">{filtered.length} of {items.length} · live · visor</Text>
        </XStack>
        <XStack items="center" gap="$2" px="$3" borderWidth={1} borderColor="$borderColor" rounded="$3">
          <Search size={14} />
          <Input flex={1} unstyled value={q} onChangeText={setQ} placeholder={kind === 'gpu' ? 'Search H100, L40S, A100…' : 'Search s-2vcpu, c-4, gpu-…'} autoCapitalize="none" py="$2" />
        </XStack>
        <YStack borderWidth={1} borderColor="$borderColor" rounded="$3" maxH={280} overflow="scroll">
          {filtered.map((it) => {
            const active = it.slug === sel
            return (
              <XStack
                key={it.slug}
                py="$2.5"
                px="$3"
                gap="$2"
                items="center"
                borderBottomWidth={1}
                borderColor="$borderColor"
                bg={active ? '$color4' : 'transparent'}
                hoverStyle={{ bg: active ? '$color4' : '$color2' }}
                cursor="pointer"
                onPress={() => setSel(it.slug)}
              >
                {it.model ? <Cpu size={15} color="$color10" /> : <Server size={15} color="$color10" />}
                <YStack flex={1} minW={0}>
                  <Text fontSize="$3" fontWeight={active ? '700' : '600'} color="$color12" numberOfLines={1}>{it.model ? `${it.gpuCount && it.gpuCount > 1 ? `${it.gpuCount}× ` : ''}${it.model}` : it.slug}</Text>
                  <Text fontSize="$1" color="$color10" numberOfLines={1}>{it.model ? it.slug : spec(it)}</Text>
                </YStack>
                <YStack items="flex-end">
                  <Text fontSize="$2" fontWeight="700" color="$color12">{mo(it.priceMonthly)}</Text>
                  <Text fontSize="$1" color="$color10">{hr(it.priceHourly)}</Text>
                </YStack>
                {active ? <Check size={15} color="$green10" /> : null}
              </XStack>
            )
          })}
          {filtered.length === 0 ? <Text p="$3" fontSize="$2" color="$color10">No {kind === 'gpu' ? 'GPUs' : 'sizes'} match “{q}”.</Text> : null}
        </YStack>
      </YStack>

      {/* Region */}
      <YStack gap="$1.5">
        <Text fontSize="$2" color="$color11" fontWeight="600">Region</Text>
        <FieldSelect value={region} options={regionOptions} onChange={setRegion} />
      </YStack>

      {/* Quote — OUR market price (== catalog == launch charge) */}
      <Card borderWidth={1} borderColor="$borderColor" p="$3" gap="$1.5" bg="$color1">
        <XStack items="center" justify="space-between">
          <Text fontSize="$2" color="$color11">Quote</Text>
          <Text fontSize="$1" color="$color10">per-org metered</Text>
        </XStack>
        {selected ? (
          <>
            <XStack items="baseline" gap="$2">
              <Text fontSize="$8" fontWeight="900" color="$color12">{mo(selected.priceMonthly)}</Text>
              <Text fontSize="$3" color="$color11">{hr(selected.priceHourly)}</Text>
            </XStack>
            <Text fontSize="$1" color="$color10" numberOfLines={2}>{spec(selected)}{region ? ` · ${region}` : ''}</Text>
            <Text fontSize="$1" color="$color10">Launching debits your Hanzo balance at the hourly rate until you destroy it.</Text>
          </>
        ) : (
          <Text fontSize="$2" color="$color10">Select a {kind === 'gpu' ? 'GPU type' : 'size'} to see the price.</Text>
        )}
      </Card>

      {error ? (
        <XStack items="flex-start" gap="$2" p="$3" rounded="$4" borderWidth={1} borderColor="$borderColor" bg="$color2">
          {error.credits ? <CreditCard size={15} color="$yellow10" /> : <AlertTriangle size={15} color="$red10" />}
          <YStack flex={1} gap="$1.5">
            <Text fontSize="$2" color="$color11">{error.msg}</Text>
            {error.credits ? (
              <Button size="$2" self="flex-start" theme="light" icon={<CreditCard size={14} />} onPress={() => { if (typeof window !== 'undefined') window.location.assign('/wallet') }}>
                Add credits
              </Button>
            ) : null}
          </YStack>
        </XStack>
      ) : null}

      {/* Actions — primary LAUNCHES; docs is the secondary "Learn more" */}
      <XStack gap="$2" pt="$1" items="center">
        <Button chromeless icon={<BookOpen size={14} />} onPress={() => { if (typeof window !== 'undefined') window.open(`${config.docsUrl}/${kind === 'gpu' ? 'gpus' : 'vm'}`, '_blank', 'noopener') }}>
          Learn more
        </Button>
        <YStack flex={1} />
        <Button chromeless onPress={onClose} disabled={phase === 'launching'}>Cancel</Button>
        <Button theme="light" icon={phase === 'launching' ? undefined : <Rocket size={15} />} disabled={!canLaunch} onPress={() => void launch()}>
          {phase === 'launching' ? <Spinner size="small" /> : `Launch${selected ? ` · ${mo(selected.priceMonthly)}` : ''}`}
        </Button>
      </XStack>
    </YStack>
  )
}
