'use client'

/**
 * Issue list + board renderers — the two Linear-grade layouts over the SAME grouped
 * data. `GroupedList` is the sectioned list (the proof view: rows grouped by the
 * chosen axis); `Board` is the horizontal status-column kanban. Both render the dense
 * `IssueRow`/`IssueCard` and support a `selectedId` highlight so the module's
 * keyboard cursor (j/k/↑/↓, Enter) is visible. Pure presentation over props — all
 * grouping/sorting is decided in `logic.ts`.
 */
import { Card, ScrollView, Text, XStack, YStack } from '@hanzo/gui'
import type { Issue, Project } from '~/lib/api/tracker'
import { type IssueGroup, relTime, teamName } from './logic'
import { StatusIcon, PriorityIcon, Identifier, KindIcon, SourceBadge, LabelChips, Avatar } from './atoms'

export type RowProps = {
  issue: Issue
  projects: Project[]
  selected?: boolean
  showTeam?: boolean
  onOpen: (i: Issue) => void
}

/** One dense list row — Linear's single-line issue row. */
export function IssueRow({ issue, projects, selected, showTeam, onOpen }: RowProps) {
  return (
    <XStack
      items="center"
      gap="$2.5"
      px="$3"
      height={40}
      bg={selected ? '$color4' : 'transparent'}
      borderLeftWidth={2}
      borderColor={selected ? '$color8' : 'transparent'}
      hoverStyle={{ bg: '$color3' }}
      cursor="pointer"
      onPress={() => onOpen(issue)}
      data-issue={issue.id}
    >
      <StatusIcon status={issue.status} />
      <PriorityIcon priority={issue.priority} size={14} />
      <YStack width={72}>
        <Identifier id={issue.identifier} />
      </YStack>
      {issue.kind !== 'issue' ? <KindIcon kind={issue.kind} /> : null}
      <Text flex={1} fontSize="$3" color="$color12" numberOfLines={1}>
        {issue.title || 'Untitled'}
      </Text>
      {showTeam ? (
        <Text display="none" $md={{ display: 'flex' }} fontSize="$1" color="$color9" className="hz-mono">
          {teamName(issue.projectKey, projects)}
        </Text>
      ) : null}
      <XStack display="none" $md={{ display: 'flex' }} items="center" gap="$2">
        <SourceBadge source={issue.source} />
        <LabelChips labels={issue.labels} max={2} />
      </XStack>
      <Text display="none" $lg={{ display: 'flex' }} fontSize="$1" color="$color9" width={44} style={{ textAlign: 'right' }}>
        {relTime(issue.updatedAt)}
      </Text>
      <Avatar name={issue.assignee} />
    </XStack>
  )
}

/** A board card — the same issue, stacked for a column. */
export function IssueCard({ issue, projects, selected, showTeam, onOpen }: RowProps) {
  return (
    <Card
      p="$2.5"
      gap="$2"
      bg="$color1"
      borderWidth={1}
      borderColor={selected ? '$color8' : '$borderColor'}
      hoverStyle={{ borderColor: '$color8' }}
      cursor="pointer"
      onPress={() => onOpen(issue)}
      data-issue={issue.id}
    >
      <XStack items="center" justify="space-between" gap="$2">
        <XStack items="center" gap="$1.5" flex={1} minW={0}>
          <Identifier id={issue.identifier} />
          {issue.kind !== 'issue' ? <KindIcon kind={issue.kind} size={12} /> : null}
        </XStack>
        <PriorityIcon priority={issue.priority} size={13} />
      </XStack>
      <Text fontSize="$3" color="$color12" numberOfLines={3}>
        {issue.title || 'Untitled'}
      </Text>
      <XStack items="center" justify="space-between" gap="$2">
        <XStack items="center" gap="$1.5" flex={1} minW={0} flexWrap="wrap">
          <SourceBadge source={issue.source} />
          <LabelChips labels={issue.labels} max={2} />
          {showTeam ? (
            <Text fontSize="$1" color="$color9" className="hz-mono">
              {teamName(issue.projectKey, projects)}
            </Text>
          ) : null}
        </XStack>
        <Avatar name={issue.assignee} size={18} />
      </XStack>
    </Card>
  )
}

/** A section header — the group label, its glyph, and a count. */
function GroupHeader({ group, glyph }: { group: IssueGroup; glyph?: React.ReactNode }) {
  return (
    <XStack items="center" gap="$2" px="$3" py="$1.5" bg="$color2" borderBottomWidth={1} borderColor="$borderColor">
      {glyph}
      <Text fontSize="$2" fontWeight="700" color="$color12">
        {group.label || 'Issues'}
      </Text>
      <Text fontSize="$2" color="$color9">
        {group.issues.length}
      </Text>
    </XStack>
  )
}

/** The sectioned list — every group with its rows. Empty groups are hidden unless
 *  `keepEmpty` (a status board keeps its empty columns; a dynamic bucket does not). */
export function GroupedList({
  groups,
  projects,
  selectedId,
  showTeam,
  keepEmpty,
  glyphFor,
  onOpen,
}: {
  groups: IssueGroup[]
  projects: Project[]
  selectedId?: string
  showTeam?: boolean
  keepEmpty?: boolean
  glyphFor?: (g: IssueGroup) => React.ReactNode
  onOpen: (i: Issue) => void
}) {
  const visible = keepEmpty ? groups : groups.filter((g) => g.issues.length > 0)
  return (
    <YStack borderWidth={1} borderColor="$borderColor" rounded="$4" overflow="hidden">
      {visible.map((g, gi) => (
        <YStack key={g.key} borderTopWidth={gi === 0 ? 0 : 1} borderColor="$borderColor">
          <GroupHeader group={g} glyph={glyphFor?.(g)} />
          {g.issues.length === 0 ? (
            <Text fontSize="$2" color="$color9" px="$3" py="$2">
              No issues
            </Text>
          ) : (
            g.issues.map((i) => (
              <YStack key={i.id} borderTopWidth={1} borderColor="$color2">
                <IssueRow issue={i} projects={projects} selected={i.id === selectedId} showTeam={showTeam} onOpen={onOpen} />
              </YStack>
            ))
          )}
        </YStack>
      ))}
    </YStack>
  )
}

/** The horizontal board — status columns of cards (always the five columns). */
export function Board({
  columns,
  projects,
  selectedId,
  showTeam,
  glyphFor,
  onOpen,
}: {
  columns: IssueGroup[]
  projects: Project[]
  selectedId?: string
  showTeam?: boolean
  glyphFor?: (g: IssueGroup) => React.ReactNode
  onOpen: (i: Issue) => void
}) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator>
      <XStack gap="$3" py="$1" items="flex-start">
        {columns.map((col) => (
          <YStack key={col.key} width={300} minW={300} gap="$2">
            <XStack items="center" gap="$2" px="$1">
              {glyphFor?.(col)}
              <Text flex={1} fontSize="$2" fontWeight="700" color="$color12">
                {col.label}
              </Text>
              <Text fontSize="$2" color="$color9">
                {col.issues.length}
              </Text>
            </XStack>
            <YStack gap="$2">
              {col.issues.length === 0 ? (
                <YStack borderWidth={1} borderColor="$borderColor" borderStyle="dashed" rounded="$4" py="$4" items="center">
                  <Text fontSize="$2" color="$color9">
                    No issues
                  </Text>
                </YStack>
              ) : (
                col.issues.map((i) => (
                  <IssueCard
                    key={i.id}
                    issue={i}
                    projects={projects}
                    selected={i.id === selectedId}
                    showTeam={showTeam}
                    onOpen={onOpen}
                  />
                ))
              )}
            </YStack>
          </YStack>
        ))}
      </XStack>
    </ScrollView>
  )
}
