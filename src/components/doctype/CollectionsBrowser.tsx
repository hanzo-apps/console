'use client'

/**
 * CollectionsBrowser — the app-lane home: the DocTypes of a `module` (a CMS
 * "collection" IS a framework DocType tagged with the lane's module). It lists
 * them as cards, offers a first-run "Set up" that installs the lane's fixtures
 * (POST /v1/framework/modules/:module/install), and a "New collection" that
 * defines a fresh content DocType. Everything is per-org and honest — an org with
 * the lane not yet installed sees the setup CTA, never a fabricated collection.
 *
 * This is generic over `module`, so CMS (`cms`), ERP (`erp`), and Helpdesk
 * (`help`) all reuse it — the ONE collections home for every lane.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Input, Text, XStack, YStack } from '@hanzo/gui'
import { Boxes, Plus, TriangleAlert } from '@hanzogui/lucide-icons-2'

import { PageHeader } from '~/components/ui/PageHeader'
import { PrimaryButton } from '~/components/ui/PrimaryButton'
import { EmptyState } from '~/components/ui/EmptyState'
import { Loader } from '~/components/ui/Loader'
import { BackendStateCard, classifyBackend, type BackendState } from '~/components/ui/BackendState'
import type { FrameworkClient } from '~/lib/framework/client'
import type { DocType } from '~/lib/framework/types'
import { moduleDoctypes, isValidDoctypeName } from '~/lib/framework/fields'

export interface CollectionsBrowserProps {
  client: FrameworkClient
  /** The app lane: 'cms' | 'erp' | 'help' | … */
  module: string
  /** Human label for the lane (e.g. "Content"). */
  label: string
  subtitle: string
  /** Open a collection's records. */
  onOpen: (doctype: string) => void
}

type LoadState =
  | { phase: 'loading' }
  | { phase: 'error'; error: BackendState }
  | { phase: 'ready'; collections: DocType[]; registered: boolean }

export function CollectionsBrowser({ client, module, label, subtitle, onOpen }: CollectionsBrowserProps) {
  const [state, setState] = useState<LoadState>({ phase: 'loading' })
  const [busy, setBusy] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [actionError, setActionError] = useState<string | null>(null)

  const load = useCallback(
    async (signal: { cancelled: boolean }) => {
      setState({ phase: 'loading' })
      try {
        const [dts, mod] = await Promise.all([
          client.doctypes.list(),
          client.modules.get(module).catch(() => null), // module may not be registered on older cloud
        ])
        if (signal.cancelled) return
        setState({ phase: 'ready', collections: moduleDoctypes(dts, module), registered: Boolean(mod && mod.doctypes.length) })
      } catch (e) {
        if (!signal.cancelled) setState({ phase: 'error', error: classifyBackend(e) })
      }
    },
    [client, module],
  )

  useEffect(() => {
    const signal = { cancelled: false }
    void load(signal)
    return () => { signal.cancelled = true }
  }, [load])

  const reload = useCallback(() => void load({ cancelled: false }), [load])

  const install = useCallback(async () => {
    setBusy(true)
    setActionError(null)
    try {
      await client.modules.install(module)
      reload()
    } catch (e) {
      setActionError(classifyBackend(e).message)
    } finally {
      setBusy(false)
    }
  }, [client, module, reload])

  const create = useCallback(async () => {
    const name = newName.trim()
    if (!isValidDoctypeName(name)) {
      setActionError('Use a name with letters, digits, dashes or underscores — no spaces.')
      return
    }
    setBusy(true)
    setActionError(null)
    try {
      await client.doctypes.create(contentCollection(name, module))
      setCreating(false)
      setNewName('')
      onOpen(name)
    } catch (e) {
      setActionError(classifyBackend(e).message)
    } finally {
      setBusy(false)
    }
  }, [client, module, newName, onOpen])

  if (state.phase === 'loading') return <Loader label={`Loading ${label}…`} />
  if (state.phase === 'error') {
    return (
      <>
        <PageHeader title={label} subtitle={subtitle} />
        <BackendStateCard state={state.error} onRetry={reload} hint="framework · GET /v1/framework/doctypes" />
      </>
    )
  }

  const { collections } = state
  return (
    <>
      <PageHeader
        title={label}
        subtitle={subtitle}
        actions={
          collections.length ? (
            <PrimaryButton size="$2" icon={<Plus size={15} />} onPress={() => { setCreating((c) => !c); setActionError(null) }}>New collection</PrimaryButton>
          ) : undefined
        }
      />

      {actionError ? (
        <Card borderWidth={1} borderColor="$red7" bg="$red2" p="$3" mb="$3" maxWidth={620}>
          <XStack gap="$2" items="center"><TriangleAlert size={15} /><Text fontSize="$3" color="$red11">{actionError}</Text></XStack>
        </Card>
      ) : null}

      {creating ? (
        <Card borderWidth={1} borderColor="$borderColor" p="$4" gap="$3" mb="$3" maxWidth={620}>
          <Text fontSize="$4" fontWeight="700">New collection</Text>
          <Text fontSize="$2" color="$color10">A content type on the framework (title, slug, body, status). Add fields later in Settings.</Text>
          <XStack gap="$2" flexWrap="wrap">
            <Input flex={1} minW={220} placeholder="e.g. Recipe or LandingPage" value={newName} onChangeText={setNewName} disabled={busy} />
            <PrimaryButton size="$2" disabled={busy} onPress={create}>{busy ? 'Creating…' : 'Create'}</PrimaryButton>
            <Button size="$2" disabled={busy} onPress={() => { setCreating(false); setNewName('') }}>Cancel</Button>
          </XStack>
        </Card>
      ) : null}

      {collections.length === 0 ? (
        <EmptyState
          icon={Boxes}
          title={`Set up ${label}`}
          description={`${label} is a set of content collections — Pages, Posts, Articles, Media, and Navigation — as DocTypes on the Hanzo Framework, per organization.`}
          bullets={[
            'Installs the default collections into your organization',
            'Content is documents on the framework — versioned, permissioned, per-org',
            'Add your own collections and fields any time',
          ]}
          primary={state.registered ? { label: busy ? 'Setting up…' : `Set up ${label}`, onPress: install } : undefined}
        />
      ) : (
        <XStack gap="$3" flexWrap="wrap">
          {collections.map((dt) => (
            <YStack
              key={dt.name}
              onPress={() => onOpen(dt.name)}
              hoverStyle={{ borderColor: '$color8' }}
              cursor="pointer"
              borderWidth={1}
              borderColor="$borderColor"
              rounded="$4"
              p="$4"
              gap="$2"
              width={240}
            >
              <XStack gap="$2" items="center">
                <Boxes size={16} />
                <Text fontSize="$4" fontWeight="700" numberOfLines={1}>{dt.name}</Text>
              </XStack>
              <Text fontSize="$2" color="$color10">
                {(dt.fields?.length ?? 0)} field{(dt.fields?.length ?? 0) === 1 ? '' : 's'}
                {dt.isSubmittable ? ' · submittable' : ''}
              </Text>
            </YStack>
          ))}
        </XStack>
      )}
    </>
  )
}

/**
 * The DocType a "New collection" creates: a minimal, immediately-usable content
 * type (title, URL slug, rich body, publish status) tagged with the lane module.
 * Secure by default — the engine seeds a System-Manager grant; the owner widens.
 */
function contentCollection(name: string, module: string): DocType {
  return {
    name,
    module,
    autoname: 'field:slug',
    titleField: 'title',
    fields: [
      { fieldname: 'title', fieldtype: 'Data', label: 'Title', reqd: true, inListView: true },
      { fieldname: 'slug', fieldtype: 'Data', label: 'Slug', reqd: true, inListView: true },
      { fieldname: 'body', fieldtype: 'Text', label: 'Body' },
      { fieldname: 'status', fieldtype: 'Select', label: 'Status', options: 'Draft\nPublished', default: 'Draft', inListView: true },
    ],
  }
}

export default CollectionsBrowser
