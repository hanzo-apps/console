'use client'

/**
 * Templates — the Hanzo starter-kit gallery (deployable app/site scaffolds,
 * `hanzoai/gallery`) browsed natively in-console over the REAL cloud
 * `/v1/templates` catalog (`TemplatesApi` → `originV1Url('templates')` → the
 * console's own `/cloud` bearer proxy).
 *
 * Browse + filter by category + search; each card hands off to the live gallery
 * to fork/deploy (`source`). Every state is honest: loading, the backend-state
 * card on error, and a true empty state — never a fabricated template card.
 *
 * The native fork-to-project flow (clone → object store → optional GitHub sync)
 * is the roadmap; today "Fork / deploy" is a real handoff to the gallery where
 * that flow works, not a faked one-click.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Card, Input, Text, XStack, YStack } from '@hanzo/gui'
import { ArrowUpRight, LayoutTemplate, RefreshCw, Search, X } from '@hanzogui/lucide-icons-2'

import { TemplatesApi, groupByCategory, type Template } from '~/lib/api/templates'
import { PageHeader } from '~/components/ui/PageHeader'
import { BackendStateCard, classifyBackend, type BackendState } from '~/components/ui/BackendState'

type Async<T> =
  | { phase: 'loading' }
  | { phase: 'error'; error: BackendState }
  | { phase: 'ready'; data: T }

const openSource = (url?: string) => {
  if (url && typeof window !== 'undefined') window.open(url, '_blank', 'noopener,noreferrer')
}

function TemplateCard({ t }: { t: Template }) {
  return (
    <Card
      p="$3"
      gap="$2"
      borderWidth={1}
      borderColor="$borderColor"
      width={320}
      hoverStyle={{ borderColor: '$color8' }}
    >
      <XStack items="center" justify="space-between" gap="$2">
        <Text fontSize="$4" fontWeight="700" numberOfLines={1}>{t.title}</Text>
        {t.framework ? <Text fontSize="$1" color="$color10" numberOfLines={1}>{t.framework}</Text> : null}
      </XStack>
      {t.description ? (
        <Text fontSize="$2" color="$color11" numberOfLines={2}>{t.description}</Text>
      ) : null}
      {t.features.length ? (
        <XStack gap="$1" flexWrap="wrap">
          {t.features.slice(0, 4).map((f) => (
            <Text key={f} fontSize="$1" color="$color10" bg="$color3" px="$2" py="$1" rounded="$10">{f}</Text>
          ))}
        </XStack>
      ) : null}
      <Button
        size="$2"
        mt="$1"
        self="flex-start"
        icon={<ArrowUpRight size={14} />}
        disabled={!t.source}
        onPress={() => openSource(t.source)}
      >
        Fork / deploy
      </Button>
    </Card>
  )
}

function TemplatesView() {
  const [state, setState] = useState<Async<Template[]>>({ phase: 'loading' })
  const [q, setQ] = useState('')
  const [cat, setCat] = useState<string | null>(null)

  const load = useCallback(() => {
    setState({ phase: 'loading' })
    TemplatesApi.list()
      .then((data) => setState({ phase: 'ready', data }))
      .catch((e) => setState({ phase: 'error', error: classifyBackend(e) }))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const all = state.phase === 'ready' ? state.data : []
  const categories = useMemo(() => groupByCategory(all).map(([c]) => c), [all])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return all.filter((t) => {
      if (cat && t.category !== cat) return false
      if (!needle) return true
      return (
        t.title.toLowerCase().includes(needle) ||
        (t.description ?? '').toLowerCase().includes(needle) ||
        t.features.some((f) => f.toLowerCase().includes(needle)) ||
        (t.useCase ?? '').toLowerCase().includes(needle)
      )
    })
  }, [all, q, cat])

  const groups = useMemo(() => groupByCategory(filtered), [filtered])

  return (
    <>
      <PageHeader
        title="Templates"
        subtitle="Production-ready starter kits — fork a template and deploy."
        actions={
          <Button size="$2" icon={<RefreshCw size={15} />} onPress={load}>
            Refresh
          </Button>
        }
      />

      {state.phase === 'error' ? (
        <BackendStateCard state={state.error} onRetry={load} hint="endpoint · GET /v1/templates" />
      ) : state.phase === 'loading' ? (
        <Text color="$color11">Loading…</Text>
      ) : all.length === 0 ? (
        <Text color="$color10">No templates available.</Text>
      ) : (
        <YStack gap="$3">
          <XStack gap="$2" items="center" flexWrap="wrap">
            <XStack items="center" gap="$2" bg="$color2" px="$3" rounded="$3" borderWidth={1} borderColor="$borderColor">
              <Search size={15} color="var(--color10)" />
              <Input
                unstyled
                placeholder="Search templates…"
                value={q}
                onChangeText={setQ}
                width={220}
                py="$2"
                fontSize="$3"
              />
              {q ? (
                <Button chromeless circular size="$1" icon={<X size={13} />} onPress={() => setQ('')} />
              ) : null}
            </XStack>
            <Button size="$2" chromeless={cat !== null} onPress={() => setCat(null)}>
              All
            </Button>
            {categories.map((c) => (
              <Button key={c} size="$2" chromeless={cat !== c} onPress={() => setCat(c)}>
                {c}
              </Button>
            ))}
          </XStack>

          {groups.length === 0 ? (
            <Text color="$color10">No templates match “{q}”.</Text>
          ) : (
            groups.map(([category, items]) => (
              <YStack key={category} gap="$2">
                <Text fontSize="$3" fontWeight="700" color="$color11">{category}</Text>
                <XStack gap="$3" flexWrap="wrap">
                  {items.map((t) => (
                    <TemplateCard key={t.slug} t={t} />
                  ))}
                </XStack>
              </YStack>
            ))
          )}
        </YStack>
      )}
    </>
  )
}

export function TemplatesModule(_props: { params: Record<string, string> }) {
  return <TemplatesView />
}
