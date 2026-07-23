'use client'

/**
 * Code hub — the unified landing ("all our code in one place"): ONE product over the
 * native git host (`/v1/git`, browse) and the code-intelligence engine (`/v1/code`,
 * cross-repo search + cited ask). Three faces on a `:tab` route:
 *
 *   Repositories — every repo the caller can see (grouped by org, filter, freshness),
 *                  each opening the repo browser (`/code/repos/:name`).
 *   Search       — hybrid cross-repo retrieval; a hit deep-links to its file.
 *   Ask          — a cited answer; each citation deep-links to its file.
 *
 * The optional repo scope (used by Search + Ask) is owned here and shared across both
 * intelligence faces, so it survives a tab switch. The in-page tab strip mirrors the
 * level-2 sub-nav (both push `/code/<tab>`), matching the other tabbed products.
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Input, Text, XStack, YStack } from '@hanzo/gui'
import { Code2 } from '@hanzogui/lucide-icons-2'

import { PageHeader } from '~/components/ui/PageHeader'
import { RepoList } from '../git/RepoList'
import { SearchFace, AskFace } from './IntelligenceFaces'
import { CODE_BASE, HUB_TABS, HUB_TAB_LABEL, type HubTab } from './hub-logic'

/** The in-page tab strip (Repositories · Search · Ask) — the gitea-style top navbar. */
function HubTabs({ active, onSelect }: { active: HubTab; onSelect: (t: HubTab) => void }) {
  return (
    <XStack gap="$1" borderBottomWidth={1} borderColor="$borderColor" flexWrap="wrap">
      {HUB_TABS.map((t) => {
        const on = t === active
        return (
          <XStack
            key={t}
            px="$3"
            py="$2"
            cursor="pointer"
            borderBottomWidth={2}
            borderColor={on ? '$color12' : 'transparent'}
            onPress={() => onSelect(t)}
            hoverStyle={{ bg: '$color2' }}
          >
            <Text fontSize="$3" fontWeight={on ? '700' : '400'} color={on ? '$color12' : '$color11'}>
              {HUB_TAB_LABEL[t]}
            </Text>
          </XStack>
        )
      })}
    </XStack>
  )
}

export function CodeHub({ tab }: { tab: HubTab }) {
  const router = useRouter()
  // One repo scope shared by Search + Ask (optional), owned here so it survives a tab
  // switch. The Repos face has its own free-text filter, so the scope input is hidden there.
  const [scope, setScope] = useState('')

  return (
    <YStack gap="$4">
      <PageHeader
        title="Code"
        subtitle="Browse every repository, search across your code, and get cited answers — the unified hub over native git."
        actions={
          tab === 'repos' ? undefined : (
            <XStack items="center" gap="$2" px="$3" borderWidth={1} borderColor="$borderColor" rounded="$3" minW={200}>
              <Code2 size={15} />
              <Input
                flex={1}
                unstyled
                value={scope}
                onChangeText={setScope}
                placeholder="Scope to repo (optional)…"
                autoCapitalize="none"
                py="$2"
              />
            </XStack>
          )
        }
      />

      <HubTabs active={tab} onSelect={(t) => router.push(`${CODE_BASE}/${t}`)} />

      {tab === 'repos' ? <RepoList /> : tab === 'search' ? <SearchFace scope={scope} /> : <AskFace scope={scope} />}
    </YStack>
  )
}
