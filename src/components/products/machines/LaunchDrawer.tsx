'use client'

/**
 * Launch drawer — the ONE real launch flow for both Machines and GPUs (a GPU is just a
 * machine with a `gpu-*` size slug, so this is shared, DRY). Opened in the shared
 * right-side `DetailPane`. It loads the COMPLETE live catalog from visor
 * (`/v1/vm/sizes` for machines, `/v1/vm/gpus` for GPUs) + the real regions, shows OUR
 * market price ($/hr + $/mo — the same visor `HanzoPrice` the launch charges), and on
 * Launch calls the native `POST /v1/visor/machines/launch` (visor-backed, per-org, Bearer-auth'd through the `/v1` proxy).
 * The new machine flows back to the caller's list via `onLaunched`. Errors are honest:
 * a 402 / "insufficient balance" becomes an "add credits" prompt; nothing is fabricated.
 */
import { useEffect, useMemo, useState } from 'react'
import { Button, Card, Input, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { AlertTriangle, BookOpen, Check, Cpu, CreditCard, Dices, Rocket, Search, Server } from '@hanzogui/lucide-icons-2'

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
import { BillingApi } from '~/lib/api/billing'
import { randomName } from '~/lib/naming'
import { FundingNote } from './FundingNote'
import { FieldSelect } from '@hanzo/ui/product'

/** A catalog row unified over CPU sizes and GPU sizes (GPU carries model/count/VRAM). */
type Item = VisorSize & Partial<Pick<VisorGpuSize, 'model' | 'gpuCount' | 'vramGb'>>

const hr = (n?: number) => (n == null ? DASH : `$${n < 1 ? n.toFixed(3) : n.toFixed(2)}/hr`)
const mo = (n?: number) => (n == null ? DASH : `$${Math.round(n).toLocaleString()}/mo`)
const usd = (n?: number) => (n == null ? DASH : `$${n.toFixed(2)}`)

/**
 * GPU billing policy (real money, NOT credits) — surfaced here and ENFORCED
 * server-side (cloud-api launch + commerce charge), so the UI can never bypass it:
 *  - PREPAY ONLY: a GPU draws against the org's card-funded PREPAID balance, never
 *    the granted/promo CREDIT balance (which stays for non-GPU DO compute).
 *  - CARD REQUIRED: no payment card on file ⇒ launch is BLOCKED with an add-card CTA.
 *  - FIRST-HOUR PREPAY: launching charges the first hour (hourly × 1) upfront; it is
 *    charged upfront. Anti-abuse; the Quote shows this floor as the "charged now".
 * CPU machines are unaffected — they stay metered to the Hanzo credit balance.
 */
const GPU_MIN_HOURS = 1
/** Navigate to a same-origin console route (add-card/prepay, add-credits). */
const goTo = (p: string) => { if (typeof window !== 'undefined') window.location.assign(p) }

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
  initialSize,
  initialRegion,
  onLaunched,
  onClose,
}: {
  kind: 'cpu' | 'gpu'
  /** Preselect a size slug (e.g. the row a customer tapped in the catalog). */
  initialSize?: string
  /** Preselect a region slug. */
  initialRegion?: string
  onLaunched: (m: VisorMachine) => void
  onClose: () => void
}) {
  const [items, setItems] = useState<Item[]>([])
  const [regions, setRegions] = useState<VisorRegion[]>([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<string>(initialSize ?? '') // selected size slug
  const [region, setRegion] = useState<string>(initialRegion ?? '')
  // Pre-fill a fun `adjective-animal` name (dark-llama, cosmic-axolotl) so launch is
  // click-and-go; the 🎲 button and a post-launch re-roll keep the rapid-launch flow fresh.
  const [name, setName] = useState(randomName)
  const [phase, setPhase] = useState<'idle' | 'launching'>('idle')
  const [error, setError] = useState<{ msg: string; needsPay: boolean } | null>(null)
  // Card-on-file gate — GPUs ONLY. `null` = still checking; a CPU machine is never
  // card-gated (treated as satisfied). FAIL CLOSED: if the saved-methods read errors
  // we treat it as "no card" so a GPU launch is BLOCKED (never a silent credit fallback).
  const [hasCard, setHasCard] = useState<boolean | null>(kind === 'gpu' ? null : true)
  // The org's spendable CREDIT balance (cents) — funds a CPU/non-GPU launch. `null`
  // until known; the funding note then omits the figure but still says "on credits".
  const [creditCents, setCreditCents] = useState<number | null>(null)

  useEffect(() => {
    let live = true
    Promise.allSettled([kind === 'gpu' ? VisorApi.gpus() : VisorApi.sizes(), VisorApi.regions()]).then(([c, r]) => {
      if (!live) return
      const cat = c.status === 'fulfilled' ? (c.value as Item[]).filter((x) => x.available) : []
      setItems(cat)
      const regs = r.status === 'fulfilled' ? r.value.filter((x) => x.available) : []
      setRegions(regs)
      setRegion((cur) => cur || initialRegion || regs[0]?.slug || '')
      setLoading(false)
    })
    // GPUs require a real payment card on file (prepay-only). Resolve it in parallel so
    // it never blocks the catalog; a failure fails closed to "no card" (gate blocks).
    if (kind === 'gpu') {
      BillingApi.paymentMethods()
        .then((pms) => { if (live) setHasCard(pms.length > 0) })
        .catch(() => { if (live) setHasCard(false) })
    } else {
      // CPU/non-GPU → surface the CREDIT balance it funds against (spendable now). A
      // failure just omits the figure (the note still says "launches on your credit").
      BillingApi.balance()
        .then((b) => { if (live) setCreditCents(b.available) })
        .catch(() => { if (live) setCreditCents(null) })
    }
    return () => {
      live = false
    }
  }, [kind, initialRegion])

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase()
    const rows = s ? items.filter((it) => `${it.slug} ${it.model ?? ''}`.toLowerCase().includes(s)) : items
    return rows.slice().sort((a, b) => (a.priceHourly ?? 0) - (b.priceHourly ?? 0))
  }, [items, q])

  const selected = useMemo(() => items.find((it) => it.slug === sel) ?? null, [items, sel])
  const regionOptions = regions.length ? regions.map((r) => r.slug) : ['nyc1']
  const isGpu = kind === 'gpu'
  // The upfront first-hour charge for a GPU (hourly × GPU_MIN_HOURS), shown in the Quote and
  // on the Launch button as "charged now". Undefined until a priced GPU is selected.
  const upfront24h = useMemo(
    () => (isGpu && selected?.priceHourly != null ? selected.priceHourly * GPU_MIN_HOURS : undefined),
    [isGpu, selected],
  )
  // GPU launches additionally require a confirmed card on file (prepay-only). The
  // server also enforces prepay + the 24h minimum, so this is the honest first gate,
  // never the sole authority.
  const cardOk = !isGpu || hasCard === true
  const canLaunch = !!selected && !!region && name.trim().length > 0 && phase === 'idle' && cardOk

  const launch = async () => {
    if (!canLaunch || !selected) return
    setPhase('launching')
    setError(null)
    try {
      const input: LaunchInput = { size: selected.slug, region, name: name.trim() }
      const m = await VisorApi.launch(input)
      // Re-roll a fresh fun name so repeat-clicking Launch keeps rapid-launching with a
      // new name each time (the drawer instance persists across the pane's close/reopen).
      setName(randomName())
      onLaunched(m)
    } catch (e) {
      const status = e instanceof ApiError ? e.status : undefined
      const msg = e instanceof Error ? e.message : String(e)
      // 402 or any payment-shaped message ⇒ a money gate, not a hard error. For a GPU
      // that means "prepay-only, add a card / prepay the 24h minimum"; for CPU it's the
      // classic "add credits". Never fabricate a launch — surface the honest CTA.
      const needsPay = status === 402 || /insufficient|balance|credit|payment|prepay|card|method/i.test(msg)
      const friendly = !needsPay
        ? msg
        : isGpu
          ? 'GPUs are prepay-only — add a payment card and prepay the first hour to launch.'
          : 'Insufficient balance — add credits to launch this machine.'
      setError({ msg: friendly, needsPay })
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
        {isGpu
          ? 'Launch a dedicated GPU machine — pick an accelerator and region.'
          : 'Launch a dedicated compute machine — pick a size and region.'}
      </Text>

      {/* Funding source — the CLEAR CPU-credit vs GPU-prepay-card distinction. A CPU
          machine launches on the credit balance (no card); a GPU is prepay-only,
          charged to the card with a first-hour prepay (and surfaces the add-card CTA
          when none is on file — the honest first gate; the server also enforces it). */}
      <FundingNote kind={kind} creditCents={creditCents} hasCard={hasCard} compact />


      {/* Name — pre-filled with a fun random name; 🎲 re-rolls, still fully editable */}
      <YStack gap="$1.5">
        <Text fontSize="$2" color="$color11" fontWeight="600">Name</Text>
        <XStack items="center" gap="$2">
          <Input flex={1} value={name} onChangeText={setName} placeholder={kind === 'gpu' ? 'my-gpu-box' : 'my-machine'} autoCapitalize="none" />
          <Button size="$3" chromeless icon={<Dices size={16} />} onPress={() => setName(randomName())} aria-label="Random name" />
        </XStack>
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

      {/* Quote — OUR market price (== catalog == launch charge). For a GPU the headline
          figure is the first hour charged upfront to the card (prepay), NOT a
          monthly estimate; for CPU it stays the per-org metered monthly/hourly. */}
      <Card borderWidth={1} borderColor="$borderColor" p="$3" gap="$1.5" bg="$color1">
        <XStack items="center" justify="space-between">
          <Text fontSize="$2" color="$color11">Quote</Text>
          <Text fontSize="$1" color="$color10">{isGpu ? 'Prepay only · first hour upfront' : 'per-org metered'}</Text>
        </XStack>
        {selected ? (
          isGpu ? (
            <>
              <XStack items="baseline" gap="$2">
                <Text fontSize="$8" fontWeight="900" color="$color12">{usd(upfront24h)}</Text>
                <Text fontSize="$3" color="$color11">charged now · {hr(selected.priceHourly)}</Text>
              </XStack>
              <Text fontSize="$1" color="$color10" numberOfLines={2}>{spec(selected)}{region ? ` · ${region}` : ''}</Text>
              <Text fontSize="$1" color="$color10">
                first hour ({hr(selected.priceHourly)}) is charged upfront to your card, then you pay the hourly rate until you destroy it. Credits can’t be used for GPUs.
              </Text>
            </>
          ) : (
            <>
              <XStack items="baseline" gap="$2">
                <Text fontSize="$8" fontWeight="900" color="$color12">{mo(selected.priceMonthly)}</Text>
                <Text fontSize="$3" color="$color11">{hr(selected.priceHourly)}</Text>
              </XStack>
              <Text fontSize="$1" color="$color10" numberOfLines={2}>{spec(selected)}{region ? ` · ${region}` : ''}</Text>
              <Text fontSize="$1" color="$color10">Launching debits your Hanzo balance at the hourly rate until you destroy it.</Text>
            </>
          )
        ) : (
          <Text fontSize="$2" color="$color10">Select a {isGpu ? 'GPU type' : 'size'} to see the price.</Text>
        )}
      </Card>

      {error ? (
        <XStack items="flex-start" gap="$2" p="$3" rounded="$4" borderWidth={1} borderColor="$borderColor" bg="$color2">
          {error.needsPay ? <CreditCard size={15} color="$yellow10" /> : <AlertTriangle size={15} color="$red10" />}
          <YStack flex={1} gap="$1.5">
            <Text fontSize="$2" color="$color11">{error.msg}</Text>
            {error.needsPay ? (
              isGpu ? (
                <Button size="$2" self="flex-start" theme="light" icon={<CreditCard size={14} />} onPress={() => goTo('/billing/credits')}>
                  Add a payment card &amp; prepay
                </Button>
              ) : (
                <Button size="$2" self="flex-start" theme="light" icon={<CreditCard size={14} />} onPress={() => goTo('/wallet')}>
                  Add credits
                </Button>
              )
            ) : null}
          </YStack>
        </XStack>
      ) : null}

      {/* Actions — primary LAUNCHES; docs is the secondary "Learn more" */}
      <XStack gap="$2" pt="$1" items="center">
        <Button chromeless icon={<BookOpen size={14} />} onPress={() => { if (typeof window !== 'undefined') window.open(`${config.docsUrl}/docs/${kind === 'gpu' ? 'gpus' : 'machines'}`, '_blank', 'noopener') }}>
          Learn more
        </Button>
        <YStack flex={1} />
        <Button chromeless onPress={onClose} disabled={phase === 'launching'}>Cancel</Button>
        <Button theme="light" icon={phase === 'launching' ? undefined : <Rocket size={15} />} disabled={!canLaunch} onPress={() => void launch()}>
          {phase === 'launching'
            ? <Spinner size="small" />
            : isGpu
              ? `Launch${upfront24h != null ? ` · ${usd(upfront24h)} now` : ''}`
              : `Launch${selected ? ` · ${mo(selected.priceMonthly)}` : ''}`}
        </Button>
      </XStack>
    </YStack>
  )
}
