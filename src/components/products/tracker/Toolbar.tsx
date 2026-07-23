'use client'

/**
 * Tracker toolbar — the Linear-grade control strip above every issue view: List⇄Board
 * toggle, a Group-by menu, a Filter menu (status / priority / kind / source / assignee
 * / label), active-filter chips with one-click clear, and a `/`-focusable search box.
 * Every control is a pure value in/out (state lives in the module), so the toolbar is
 * a dumb, reusable renderer. @hanzo/gui Popover menus, shorthands only.
 */
import { forwardRef } from 'react'
import { Button, Input, Popover, ScrollView, Text, XStack, YStack } from '@hanzo/gui'
import {
  ListChecks,
  LayoutGrid,
  ChevronDown,
  Filter as FilterIcon,
  Search,
  X,
} from '@hanzogui/lucide-icons-2'

import { STATUSES, PRIORITIES, KINDS, SOURCES } from '~/lib/api/tracker'
import {
  type GroupBy,
  type IssueFilters,
  GROUP_BY,
  GROUP_BY_LABEL,
  STATUS_LABEL,
  PRIORITY_LABEL,
  KIND_LABEL,
  SOURCE_LABEL,
  countFilters,
} from './logic'
import { StatusIcon, PriorityIcon } from './atoms'

type Opt = { value: string; label: string; glyph?: React.ReactElement }

/** A Popover single-select menu — a labeled trigger, a scrollable option list, an
 *  optional clear. Selecting closes via the controlled `Popover` (uncontrolled here
 *  is fine — Radix closes on outer press). */
function Menu({
  trigger,
  options,
  value,
  onChange,
  clearLabel,
}: {
  trigger: React.ReactNode
  options: Opt[]
  value?: string
  onChange: (v: string) => void
  clearLabel?: string
}) {
  return (
    <Popover placement="bottom-start">
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Content bordered elevate p="$1.5" width={220} bg="$color2" borderColor="$borderColor">
        <ScrollView maxH={320}>
          <YStack gap="$0.5">
            {clearLabel ? (
              <Button
                size="$2"
                chromeless
                justify="flex-start"
                onPress={() => onChange('')}
                bg={!value ? '$color4' : 'transparent'}
              >
                <Text fontSize="$2" color="$color11">
                  {clearLabel}
                </Text>
              </Button>
            ) : null}
            {options.map((o) => (
              <Button
                key={o.value}
                size="$2"
                chromeless
                justify="flex-start"
                icon={o.glyph ?? undefined}
                onPress={() => onChange(o.value)}
                bg={value === o.value ? '$color4' : 'transparent'}
              >
                <Text fontSize="$2" color="$color12">
                  {o.label}
                </Text>
              </Button>
            ))}
          </YStack>
        </ScrollView>
      </Popover.Content>
    </Popover>
  )
}

/** A quiet filter chip: "Status: Todo ✕". */
function Chip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <XStack items="center" gap="$1.5" px="$2" py="$1" rounded="$3" bg="$color3" borderWidth={1} borderColor="$borderColor">
      <Text fontSize="$1" color="$color11" fontWeight="500">
        {label}
      </Text>
      <Text onPress={onClear} cursor="pointer" color="$color10" hoverStyle={{ color: '$color12' }} aria-label={`Clear ${label}`}>
        <X size={12} />
      </Text>
    </XStack>
  )
}

export type ToolbarProps = {
  view: 'list' | 'board'
  onView: (v: 'list' | 'board') => void
  groupBy: GroupBy
  onGroupBy: (g: GroupBy) => void
  filters: IssueFilters
  onFilters: (f: IssueFilters) => void
  query: string
  onQuery: (q: string) => void
  /** dynamic option lists derived from the current issue set. */
  assignees: string[]
  labels: string[]
  /** right-aligned actions (Refresh / New / Sync). */
  actions?: React.ReactNode
  /** hide the board toggle (roadmap/cycles are list-only). */
  listOnly?: boolean
}

export const Toolbar = forwardRef<HTMLInputElement, ToolbarProps>(function Toolbar(
  { view, onView, groupBy, onGroupBy, filters, onFilters, query, onQuery, assignees, labels, actions, listOnly },
  searchRef,
) {
  const set = (patch: Partial<IssueFilters>) => onFilters({ ...filters, ...patch })
  const n = countFilters({ ...filters, q: '' }) // q shown in the search box, not as a chip

  return (
    <YStack gap="$2.5">
      <XStack items="center" gap="$2" flexWrap="wrap">
        {/* Search — `/` focuses this (see module). */}
        <XStack
          items="center"
          gap="$2"
          px="$2.5"
          height={34}
          minW={220}
          flex={1}
          $md={{ flex: 0, width: 280 }}
          rounded="$3"
          borderWidth={1}
          borderColor="$borderColor"
          bg="$color2"
        >
          <Search size={14} opacity={0.6} />
          <Input
            ref={searchRef as never}
            flex={1}
            unstyled
            value={query}
            onChangeText={onQuery}
            placeholder="Search issues…  ( / )"
            fontSize="$3"
            color="$color12"
            autoCapitalize="none"
            autoCorrect={false}
          />
          {query ? (
            <Button size="$1" chromeless icon={<X size={13} />} onPress={() => onQuery('')} aria-label="Clear search" />
          ) : null}
        </XStack>

        {/* Group-by */}
        <Menu
          trigger={
            <Button size="$2" icon={<ChevronDown size={14} />} iconAfter={undefined}>
              Group: {GROUP_BY_LABEL[groupBy]}
            </Button>
          }
          value={groupBy}
          options={GROUP_BY.map((g) => ({ value: g, label: GROUP_BY_LABEL[g] }))}
          onChange={(v) => onGroupBy((v || 'status') as GroupBy)}
        />

        {/* Filter */}
        <Menu
          trigger={
            <Button size="$2" icon={<FilterIcon size={14} />} theme={n > 0 ? 'light' : undefined}>
              Filter{n > 0 ? ` · ${n}` : ''}
            </Button>
          }
          value={filters.status}
          clearLabel="Any status"
          options={STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s], glyph: <StatusIcon status={s} size={14} /> }))}
          onChange={(v) => set({ status: (v || undefined) as IssueFilters['status'] })}
        />
        <Menu
          trigger={<Button size="$2">Priority</Button>}
          value={filters.priority}
          clearLabel="Any priority"
          options={PRIORITIES.map((p) => ({ value: p, label: PRIORITY_LABEL[p], glyph: <PriorityIcon priority={p} size={13} /> }))}
          onChange={(v) => set({ priority: (v || undefined) as IssueFilters['priority'] })}
        />
        <Menu
          trigger={<Button size="$2">Kind</Button>}
          value={filters.kind}
          clearLabel="Any kind"
          options={KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }))}
          onChange={(v) => set({ kind: (v || undefined) as IssueFilters['kind'] })}
        />
        <Menu
          trigger={<Button size="$2">Source</Button>}
          value={filters.source}
          clearLabel="Any source"
          options={SOURCES.map((s) => ({ value: s, label: SOURCE_LABEL[s] }))}
          onChange={(v) => set({ source: (v || undefined) as IssueFilters['source'] })}
        />
        {assignees.length > 0 ? (
          <Menu
            trigger={<Button size="$2">Assignee</Button>}
            value={filters.assignee}
            clearLabel="Anyone"
            options={assignees.map((a) => ({ value: a, label: a }))}
            onChange={(v) => set({ assignee: v || undefined })}
          />
        ) : null}
        {labels.length > 0 ? (
          <Menu
            trigger={<Button size="$2">Label</Button>}
            value={filters.label}
            clearLabel="Any label"
            options={labels.map((l) => ({ value: l, label: l }))}
            onChange={(v) => set({ label: v || undefined })}
          />
        ) : null}

        {/* View toggle */}
        {!listOnly ? (
          <XStack gap="$1" ml="auto">
            <Button
              size="$2"
              theme={view === 'list' ? 'light' : undefined}
              chromeless={view !== 'list'}
              icon={<ListChecks size={15} />}
              onPress={() => onView('list')}
              aria-label="List view"
            />
            <Button
              size="$2"
              theme={view === 'board' ? 'light' : undefined}
              chromeless={view !== 'board'}
              icon={<LayoutGrid size={15} />}
              onPress={() => onView('board')}
              aria-label="Board view"
            />
          </XStack>
        ) : null}

        {actions ? (
          <XStack gap="$2" items="center" ml={listOnly ? 'auto' : undefined}>
            {actions}
          </XStack>
        ) : null}
      </XStack>

      {/* Active-filter chips */}
      {n > 0 ? (
        <XStack gap="$1.5" flexWrap="wrap" items="center">
          {filters.status ? <Chip label={`Status: ${STATUS_LABEL[filters.status]}`} onClear={() => set({ status: undefined })} /> : null}
          {filters.priority ? <Chip label={`Priority: ${PRIORITY_LABEL[filters.priority]}`} onClear={() => set({ priority: undefined })} /> : null}
          {filters.kind ? <Chip label={`Kind: ${KIND_LABEL[filters.kind]}`} onClear={() => set({ kind: undefined })} /> : null}
          {filters.source ? <Chip label={`Source: ${SOURCE_LABEL[filters.source]}`} onClear={() => set({ source: undefined })} /> : null}
          {filters.assignee ? <Chip label={`Assignee: ${filters.assignee}`} onClear={() => set({ assignee: undefined })} /> : null}
          {filters.label ? <Chip label={`Label: ${filters.label}`} onClear={() => set({ label: undefined })} /> : null}
          {filters.team ? <Chip label={`Team: ${filters.team}`} onClear={() => set({ team: undefined })} /> : null}
          <Button size="$1" chromeless onPress={() => onFilters({ q: filters.q })} aria-label="Clear all filters">
            <Text fontSize="$1" color="$color10" fontWeight="600">
              Clear all
            </Text>
          </Button>
        </XStack>
      ) : null}
    </YStack>
  )
})
