'use client'

/**
 * Scope switcher — the project + environment pickers that scope every module.
 *
 * Two chips next to the org switcher: the active PROJECT (or "All projects" for
 * org-level scope) and the active ENVIRONMENT (mainnet/testnet/devnet + custom).
 * Both write through `useScope`, which updates the module-level scope the API
 * client reads — so changing either re-scopes every product at once. A "New
 * project" affordance routes to the Projects module; we never fabricate a project.
 */
import type { ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Popover, Text, XStack, YStack } from '@hanzo/gui'
import { Check, ChevronsUpDown, FolderGit2, Layers, Plus } from '@hanzogui/lucide-icons-2'

import { useScope } from '~/lib/scope-context'
import { STOCK_ENVIRONMENTS } from '~/lib/scope'

/** A small colored dot keyed to the environment's network tier. */
type DotColor = '$green10' | '$yellow10' | '$blue10' | '$purple10'
const ENV_DOT: Record<string, DotColor> = {
  mainnet: '$green10',
  testnet: '$yellow10',
  devnet: '$blue10',
}
const envDot = (env: string): DotColor => ENV_DOT[env] ?? '$purple10'
const titleCase = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)

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
      <Popover.Content bordered elevate p="$2" width={260} bg="$color2" borderColor="$borderColor">
        <YStack gap="$0.5">
          <Text px="$2" py="$1" fontSize="$1" color="$color10" fontWeight="700" textTransform="uppercase">
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

function EnvironmentPicker() {
  const { scope, environments, selectEnvironment } = useScope()

  return (
    <Popover placement="bottom-end">
      <Popover.Trigger asChild>
        <Button size="$2" chromeless icon={<Layers size={14} />} iconAfter={<ChevronsUpDown size={13} />}>
          <XStack items="center" gap="$2">
            <YStack width={8} height={8} rounded={999} bg={envDot(scope.environment)} />
            <Text fontSize="$2" color="$color12">
              {scope.environment}
            </Text>
          </XStack>
        </Button>
      </Popover.Trigger>
      <Popover.Content bordered elevate p="$2" width={220} bg="$color2" borderColor="$borderColor">
        <YStack gap="$0.5">
          <Text px="$2" py="$1" fontSize="$1" color="$color10" fontWeight="700" textTransform="uppercase">
            Environment
          </Text>
          {environments.map((env) => {
            const stock = (STOCK_ENVIRONMENTS as readonly string[]).includes(env)
            return (
              <Row
                key={env}
                label={titleCase(env)}
                sub={stock ? undefined : 'Custom'}
                dot={envDot(env)}
                active={scope.environment === env}
                onPress={() => selectEnvironment(env)}
              />
            )
          })}
        </YStack>
      </Popover.Content>
    </Popover>
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
      {dot ? <YStack width={8} height={8} rounded={999} bg={dot} /> : icon}
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

/** Project + environment pickers as a unit (topbar). */
export function ScopeSwitcher() {
  return (
    <XStack items="center" gap="$1">
      <ProjectPicker />
      <EnvironmentPicker />
    </XStack>
  )
}
