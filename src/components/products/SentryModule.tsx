'use client'

/**
 * Hanzo Sentry — the error/log/trace product face, one module routed by `:tab`
 * (+ a `:tab/:id` detail) under `/sentry`. It is the Sentry PRODUCT wearing Hanzo's
 * identity + @hanzo/gui design system (no upstream Sentry look): the sentry.<brand>
 * shell (config.shell) surfaces these panels in the sidebar via ONE brand — this
 * module composes them and stays self-contained (its own tab strip) so it also
 * works when reached at `/sentry` on any host.
 *
 * Panels are thin views over the real `/v1/sentry` contract (`SentryApi`), each with
 * honest loading / empty / `ErrorState` states — never fabricated data. The projects
 * list (the shared project-filter source) is fetched ONCE here and threaded down.
 */
import { useEffect, useMemo, useState } from 'react'
import { useRouter } from '~/lib/router'
import { Button, ScrollView, Text, XStack, YStack } from '@hanzo/gui'
import { Activity, AlertTriangle, Boxes, Compass, Route, ScrollText, Users } from '@hanzogui/lucide-icons-2'

import { SentryApi, type SentryProject } from '~/lib/api/sentry'
import { config } from '~/config'
import { IssuesPanel } from './sentry/IssuesPanel'
import { IssueDetailPanel } from './sentry/IssueDetailPanel'
import { DiscoverPanel } from './sentry/DiscoverPanel'
import { LogsPanel } from './sentry/LogsPanel'
import { TracesPanel } from './sentry/TracesPanel'
import { StatsPanel } from './sentry/StatsPanel'
import { ProjectsPanel } from './sentry/ProjectsPanel'
import { MembersPanel } from './sentry/MembersPanel'

/** The Sentry panels, in nav order. `id: ''` is the index (Issues). ONE source the
 *  tab strip AND the registry sub-pages derive from. */
export const SENTRY_TABS = [
  { id: '', slug: 'issues', label: 'Issues', icon: AlertTriangle },
  { id: 'discover', slug: 'discover', label: 'Discover', icon: Compass },
  { id: 'logs', slug: 'logs', label: 'Logs', icon: ScrollText },
  { id: 'traces', slug: 'traces', label: 'Traces', icon: Route },
  { id: 'stats', slug: 'stats', label: 'Monitor', icon: Activity },
  { id: 'projects', slug: 'projects', label: 'Projects', icon: Boxes },
  { id: 'members', slug: 'members', label: 'Members', icon: Users },
] as const

export function SentryModule({ params }: { params: Record<string, string> }) {
  const router = useRouter()
  const [projects, setProjects] = useState<SentryProject[]>([])

  useEffect(() => {
    SentryApi.projects().then(setProjects).catch(() => setProjects([]))
  }, [])

  // `/sentry` → tab '' (Issues); `/sentry/issues/:id` normalizes to the Issues tab.
  const rawTab = params.tab ?? ''
  const tab = rawTab === 'issues' ? '' : rawTab
  const id = params.id

  const panel = useMemo(() => {
    switch (tab) {
      case '':
        return id ? <IssueDetailPanel id={id} /> : <IssuesPanel projects={projects} />
      case 'discover':
        return <DiscoverPanel projects={projects} />
      case 'logs':
        return <LogsPanel projects={projects} />
      case 'traces':
        return <TracesPanel id={id} projects={projects} />
      case 'stats':
        return <StatsPanel projects={projects} />
      case 'projects':
        return <ProjectsPanel />
      case 'members':
        return <MembersPanel />
      default:
        return <IssuesPanel projects={projects} />
    }
  }, [tab, id, projects])

  const go = (slugId: string) => router.push(slugId ? `/sentry/${slugId}` : '/sentry')

  return (
    <YStack gap="$4" p="$4" maxW={1200} width="100%" self="center">
      {/* Self-contained tab strip — the shell sidebar mirrors it on sentry.<brand>,
          and it is the only nav when the module is reached at /sentry elsewhere. */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <XStack gap="$1" items="center" borderBottomWidth={1} borderColor="$borderColor" pb="$2" width="100%">
          {SENTRY_TABS.map((t) => {
            const active = t.id === tab
            return (
              <Button
                key={t.slug}
                size="$2.5"
                chromeless
                bg={active ? '$color4' : 'transparent'}
                icon={<t.icon size={15} color={active ? 'var(--color12)' : 'var(--color10)'} />}
                onPress={() => go(t.id)}
              >
                <Text fontSize="$3" color={active ? '$color12' : '$color11'} fontWeight={active ? '600' : '400'}>
                  {t.label}
                </Text>
              </Button>
            )
          })}
        </XStack>
      </ScrollView>

      {panel}

      <Text fontSize="$1" color="$color10" self="center">
        Hanzo Sentry · {config.brandName} · errors, logs and traces on /v1/sentry
      </Text>
    </YStack>
  )
}
