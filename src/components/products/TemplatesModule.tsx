'use client'

/**
 * Templates — the Hanzo starter-kit gallery (deployable app/site scaffolds,
 * `hanzoai/gallery`) browsed natively in-console over the REAL cloud
 * `/v1/templates` catalog (`TemplatesApi` → `originV1Url('templates')` → the
 * console's own `/cloud` bearer proxy).
 *
 * Browse + filter by category + search. The primary CTA is "Open in builder"
 * (the fork → customize loop): the card takes an optional free-text
 * customization and deep-links to the hanzo.app builder pre-seeded with this
 * starter (`buildBuilderUrl` → `<app>/dev?template=…&prompt=…&action=edit`), which
 * auto-starts the first generation so the user lands on a customized first
 * edition and can talk-and-edit → deploy. "Fork / deploy" (secondary) still
 * creates a REAL project in-console via `TemplatesApi.fork` → cloud
 * `POST /v1/projects/fork`: projectsvc seeds an org-scoped Project from the
 * template (framework mapped, repo = gallery source). Every state is honest:
 * loading, the backend-state card on error, a true empty state, per-card
 * forking/created/error — never a fabricated card. If the fork route is absent
 * (older backend → 404) it falls back to opening the gallery source, so the
 * button is never dead.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Card, Input, Text, XStack, YStack } from '@hanzo/gui'
import { ArrowUpRight, Check, LayoutTemplate, Loader, RefreshCw, Search, Sparkles, X } from '@hanzogui/lucide-icons-2'

import { TemplatesApi, buildBuilderUrl, groupByCategory, type ForkedProject, type Template } from '~/lib/api/templates'
import { ApiError } from '~/lib/api/client'
import { config } from '~/config'
import { PageHeader } from '~/components/ui/PageHeader'
import { BackendStateCard, classifyBackend, type BackendState } from '~/components/ui/BackendState'

type Async<T> =
  | { phase: 'loading' }
  | { phase: 'error'; error: BackendState }
  | { phase: 'ready'; data: T }

const openSource = (url?: string) => {
  if (url && typeof window !== 'undefined') window.open(url, '_blank', 'noopener,noreferrer')
}

// Per-card fork state: idle → forking → forked (success) | error. On a 404 (an
// older backend without the fork route) we don't surface an error — we fall back
// to the previous behavior (open the gallery source), so the button is never dead.
type ForkState =
  | { phase: 'idle' }
  | { phase: 'forking' }
  | { phase: 'forked'; project: ForkedProject }
  | { phase: 'error'; message: string }

function TemplateCard({ t }: { t: Template }) {
  const [fork, setFork] = useState<ForkState>({ phase: 'idle' })
  // Optional free-text customization the user types before opening the builder.
  const [userText, setUserText] = useState('')

  // Open in builder (the fork → customize loop): deep-links to the hanzo.app
  // builder pre-seeded with this starter + the customization ask. The seed prompt
  // carries the template context, so the builder auto-starts the first generation.
  const openBuilder = useCallback(() => {
    if (typeof window === 'undefined') return
    window.open(buildBuilderUrl(t, userText, config.appUrl), '_blank', 'noopener,noreferrer')
  }, [t, userText])

  const onFork = useCallback(() => {
    // No fork target and no source → nothing we can do (button is disabled below).
    setFork({ phase: 'forking' })
    TemplatesApi.fork(t.slug)
      .then((project) => setFork({ phase: 'forked', project }))
      .catch((e) => {
        // Honest fallback: a 404 means this backend has no fork route yet — open
        // the gallery source (the original behavior) instead of showing an error.
        if (e instanceof ApiError && e.status === 404 && t.source) {
          openSource(t.source)
          setFork({ phase: 'idle' })
          return
        }
        setFork({ phase: 'error', message: e instanceof Error ? e.message : 'Fork failed' })
      })
  }, [t.slug, t.source])

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

      {/* Fork → builder: type an optional customization, then open the builder
          pre-seeded with this starter — it auto-starts the first generation. */}
      <XStack
        items="center"
        gap="$2"
        bg="$color2"
        px="$3"
        rounded="$3"
        borderWidth={1}
        borderColor="$borderColor"
        mt="$1"
      >
        <Input
          unstyled
          placeholder="Customize (optional), e.g. add dark mode"
          value={userText}
          onChangeText={setUserText}
          flex={1}
          py="$2"
          fontSize="$2"
        />
      </XStack>
      <Button size="$2" self="flex-start" icon={<Sparkles size={14} />} onPress={openBuilder}>
        Open in builder
      </Button>

      {fork.phase === 'forked' ? (
        <YStack gap="$1" mt="$1">
          <XStack items="center" gap="$2">
            <Check size={14} color="var(--green10)" />
            <Text fontSize="$2" color="$color11" numberOfLines={1}>
              Project “{fork.project.name}” created
            </Text>
          </XStack>
          {fork.project.liveUrl ? (
            <Button
              size="$2"
              self="flex-start"
              icon={<ArrowUpRight size={14} />}
              onPress={() => openSource(fork.project.liveUrl)}
            >
              Open site
            </Button>
          ) : (
            <Text fontSize="$1" color="$color10">
              Draft ({fork.project.framework}) — deploy it to go live.
            </Text>
          )}
        </YStack>
      ) : (
        <>
          <Button
            size="$2"
            chromeless
            self="flex-start"
            icon={fork.phase === 'forking' ? <Loader size={14} /> : <ArrowUpRight size={14} />}
            disabled={fork.phase === 'forking' || (!t.source && !t.slug)}
            onPress={onFork}
          >
            {fork.phase === 'forking' ? 'Forking…' : 'Fork / deploy'}
          </Button>
          {fork.phase === 'error' ? (
            <Text fontSize="$1" color="$red10" numberOfLines={2}>{fork.message}</Text>
          ) : null}
        </>
      )}
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
