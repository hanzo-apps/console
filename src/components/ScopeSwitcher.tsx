'use client'

/**
 * Scope switcher — the project + network pickers that scope every module.
 *
 * Two chips next to the org switcher: the active PROJECT (or "All projects" for
 * org-level scope) and the active NETWORK. The network picker offers the stock
 * tiers (Mainnet/Testnet/Devnet — the live Hanzo networks), a Local option for a
 * self-hosted cloud binary, and any custom networks the user adds (their own
 * networkID / EVM chainID / RPC / API). Selecting a network writes through
 * `useScope`, which updates the module-level scope the API client reads — so it
 * re-scopes every module (via `X-Environment`) AND retargets chain/RPC/API at once.
 * A "New project" affordance routes to the Projects module; we never fabricate one.
 */
import { useMemo, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Popover, Text, XStack, YStack } from '@hanzo/gui'
import { Check, ChevronsUpDown, FolderGit2, Layers, Plus, Trash } from '@hanzogui/lucide-icons-2'

import { useScope } from '~/lib/scope-context'
import { STOCK_ENVIRONMENTS } from '~/lib/scope'
import { isStockNetwork, parseCustomNetwork, type Network } from '~/lib/network'
import { FieldText } from '~/components/ui/Field'
import { paper } from '~/components/ui/paper'

/** A small dot keyed to the network tier. Monochrome by default; only the genuine
 *  states carry a hue — mainnet is live (green), testnet is a caution (amber). Every
 *  other tier is a neutral off the design ladder (Tamagui $colorN). */
type DotColor = '$green10' | '$yellow10' | '$color10' | '$color9' | '$color8'
const NET_DOT: Record<string, DotColor> = {
  mainnet: '$green10',
  testnet: '$yellow10',
  devnet: '$color10',
  local: '$color8',
}
const netDot = (n: Network): DotColor => (n.custom ? '$color9' : NET_DOT[n.id] ?? '$color9')
const envDot = (env: string): DotColor => NET_DOT[env] ?? '$color9'
const titleCase = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)

/** The (networkID, evmChainID) subtitle — collapsed when they're equal (sovereign L1). */
const idSub = (n: Network): string =>
  n.networkID === n.evmChainID ? `Chain ${n.evmChainID}` : `Net ${n.networkID} · Chain ${n.evmChainID}`

function ProjectPicker() {
  const router = useRouter()
  const { scope, projects, loadingProjects, selectProject } = useScope()
  const label = scope.project ? scope.project : 'All projects'

  return (
    <Popover placement="bottom-end">
      <Popover.Trigger asChild>
        <Button size="$2" chromeless icon={<FolderGit2 size={14} />} iconAfter={<ChevronsUpDown size={13} />}>
          {label}
        </Button>
      </Popover.Trigger>
      <Popover.Content {...paper} p="$2" width={260}>
        <YStack gap="$0.5">
          <Text px="$2" py="$1" fontSize="$1" color="$color10" fontWeight="500">
            Project
          </Text>

          {/* Org-level scope — no X-Project-Id sent. */}
          <Row
            label="All projects"
            sub="Org-level"
            active={!scope.project}
            onPress={() => selectProject(undefined)}
          />

          {projects.map((p) => (
            <Row
              key={p.name}
              label={p.displayName || p.name}
              active={scope.project === p.name}
              onPress={() => selectProject(p.name)}
            />
          ))}

          {projects.length === 0 && !loadingProjects ? (
            <Text px="$2" py="$1.5" fontSize="$2" color="$color10">
              No projects yet.
            </Text>
          ) : null}

          <XStack height={1} bg="$borderColor" my="$1" />
          <Row
            label="New project"
            icon={<Plus size={14} />}
            onPress={() => router.push('/projects')}
          />
        </YStack>
      </Popover.Content>
    </Popover>
  )
}

const EMPTY_FORM = { label: '', networkID: '', evmChainID: '', rpcEndpoint: '', apiEndpoint: '' }

function AddNetworkForm({
  taken,
  onAdd,
  onCancel,
}: {
  taken: ReadonlySet<string>
  onAdd: (net: Network) => void
  onCancel: () => void
}) {
  const [form, setForm] = useState(EMPTY_FORM)
  const [error, setError] = useState<string | null>(null)
  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }))

  const submit = () => {
    const r = parseCustomNetwork(form, taken)
    if ('error' in r) {
      setError(r.error)
      return
    }
    onAdd(r.network)
  }

  return (
    <YStack gap="$2" px="$2" py="$1.5">
      <FieldText value={form.label} onChange={set('label')} placeholder="Name (e.g. Home)" />
      <FieldText value={form.networkID} onChange={set('networkID')} placeholder="Network ID (e.g. 70000)" />
      <FieldText value={form.evmChainID} onChange={set('evmChainID')} placeholder="EVM chain ID (defaults to Network ID)" />
      <FieldText value={form.rpcEndpoint} onChange={set('rpcEndpoint')} placeholder="RPC URL (https://…)" />
      <FieldText value={form.apiEndpoint} onChange={set('apiEndpoint')} placeholder="API URL (blank = same-origin)" />
      {error ? (
        <Text fontSize="$1" color="$red10">
          {error}
        </Text>
      ) : null}
      <XStack gap="$2" justify="flex-end">
        <Button size="$2" chromeless onPress={onCancel}>
          Cancel
        </Button>
        <Button size="$2" icon={<Plus size={14} />} onPress={submit}>
          Add
        </Button>
      </XStack>
    </YStack>
  )
}

function NetworkPicker() {
  const { scope, networks, environments, activeNetwork, selectEnvironment, addCustomNetwork, removeCustomNetwork } =
    useScope()
  const [adding, setAdding] = useState(false)

  const takenCustomIds = useMemo(
    () => new Set(networks.filter((n) => n.custom).map((n) => n.id)),
    [networks],
  )

  // Project-custom environments (a project's own env names) that are NOT networks —
  // surfaced so selecting one still re-scopes X-Environment (default network endpoints).
  const networkIds = useMemo(() => new Set(networks.map((n) => n.id)), [networks])
  const extraEnvs = useMemo(
    () => environments.filter((e) => !networkIds.has(e) && !(STOCK_ENVIRONMENTS as readonly string[]).includes(e)),
    [environments, networkIds],
  )

  const add = (net: Network) => {
    addCustomNetwork(net)
    setAdding(false)
  }

  return (
    <Popover placement="bottom-end">
      <Popover.Trigger asChild>
        <Button size="$2" chromeless icon={<Layers size={14} />} iconAfter={<ChevronsUpDown size={13} />}>
          <XStack items="center" gap="$2">
            <YStack width={8} height={8} rounded="$10" bg={netDot(activeNetwork)} />
            <Text fontSize="$2" color="$color12">
              {activeNetwork.label}
            </Text>
          </XStack>
        </Button>
      </Popover.Trigger>
      <Popover.Content {...paper} p="$2" width={300}>
        <YStack gap="$0.5">
          <Text px="$2" py="$1" fontSize="$1" color="$color10" fontWeight="500">
            Network
          </Text>

          {networks.map((n) => (
            <NetworkRow
              key={n.id}
              net={n}
              active={scope.environment === n.id}
              onPress={() => selectEnvironment(n.id)}
              onRemove={n.custom ? () => removeCustomNetwork(n.id) : undefined}
            />
          ))}

          {extraEnvs.length ? (
            <>
              <XStack height={1} bg="$borderColor" my="$1" />
              <Text px="$2" py="$1" fontSize="$1" color="$color10" fontWeight="500">
                Project environments
              </Text>
              {extraEnvs.map((env) => (
                <Row
                  key={env}
                  label={titleCase(env)}
                  sub="Custom"
                  dot={envDot(env)}
                  active={scope.environment === env}
                  onPress={() => selectEnvironment(env)}
                />
              ))}
            </>
          ) : null}

          <XStack height={1} bg="$borderColor" my="$1" />
          {adding ? (
            <AddNetworkForm taken={takenCustomIds} onAdd={add} onCancel={() => setAdding(false)} />
          ) : (
            <Row label="Add custom network" icon={<Plus size={14} />} onPress={() => setAdding(true)} />
          )}
        </YStack>
      </Popover.Content>
    </Popover>
  )
}

/** A network row: pressable identity (dot + label + chain sub + check) with an optional remove. */
function NetworkRow({
  net,
  active,
  onPress,
  onRemove,
}: {
  net: Network
  active?: boolean
  onPress: () => void
  onRemove?: () => void
}) {
  return (
    <XStack items="center" gap="$1" rounded="$3" hoverStyle={{ bg: '$color4' }}>
      <XStack flex={1} onPress={onPress} cursor="pointer" items="center" gap="$2" px="$2" py="$2">
        <YStack width={8} height={8} rounded="$10" bg={netDot(net)} />
        <YStack flex={1}>
          <Text fontSize="$2" color="$color12" numberOfLines={1}>
            {net.label}
          </Text>
          <Text fontSize="$1" color="$color10" numberOfLines={1}>
            {idSub(net)}
          </Text>
        </YStack>
        {active ? <Check size={14} /> : null}
      </XStack>
      {onRemove ? (
        <Button
          size="$2"
          chromeless
          icon={<Trash size={13} />}
          onPress={onRemove}
          aria-label={`Remove ${net.label}`}
        />
      ) : null}
    </XStack>
  )
}

/** One selectable row in a picker popover. */
function Row({
  label,
  sub,
  dot,
  icon,
  active,
  onPress,
}: {
  label: string
  sub?: string
  dot?: DotColor
  icon?: ReactNode
  active?: boolean
  onPress: () => void
}) {
  return (
    <XStack
      onPress={onPress}
      cursor="pointer"
      items="center"
      gap="$2"
      px="$2"
      py="$2"
      rounded="$3"
      hoverStyle={{ bg: '$color4' }}
    >
      {dot ? <YStack width={8} height={8} rounded="$10" bg={dot} /> : icon}
      <YStack flex={1}>
        <Text fontSize="$2" color="$color12" numberOfLines={1}>
          {label}
        </Text>
        {sub ? (
          <Text fontSize="$1" color="$color10">
            {sub}
          </Text>
        ) : null}
      </YStack>
      {active ? <Check size={14} /> : null}
    </XStack>
  )
}

/** Project + network pickers as a unit (topbar). */
export function ScopeSwitcher() {
  return (
    <XStack items="center" gap="$1">
      <ProjectPicker />
      <NetworkPicker />
    </XStack>
  )
}
