'use client'

/**
 * Dashboard route error backstop (Next App Router).
 *
 * `ProductErrorBoundary` catches throws inside a resolved product module; this
 * catches anything above it in the dashboard page tree (the resolver itself, a
 * non-catch-all dashboard page). It renders in the layout's content slot, so the
 * shell + nav stay mounted — never a white-screened "Application error". Next's
 * `reset()` re-renders the segment; `notFound()`/`redirect()` are control flow and
 * do not reach here.
 */
import { useEffect } from 'react'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { RefreshCw, TriangleAlert } from '@hanzogui/lucide-icons-2'

import { isChunkLoadError } from '~/components/errors/boundary-logic'

export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[console] dashboard route error:', error)
  }, [error])

  const chunk = isChunkLoadError(error)
  return (
    <YStack p="$4">
      <Card borderWidth={1} borderColor="$borderColor" p="$4" gap="$3" maxWidth={640} bg="$color1">
        <XStack gap="$2" items="center">
          <TriangleAlert size={16} />
          <Text fontSize="$4" fontWeight="700">
            {chunk ? 'Updating to the latest version' : 'This page hit an unexpected error'}
          </Text>
        </XStack>
        <Text fontSize="$3" color="$color11">
          {chunk
            ? 'A newer version of the console just shipped. Reload to load the latest.'
            : 'The rest of the console still works. Try again, or reload the page.'}
        </Text>
        <XStack gap="$2">
          {!chunk ? (
            <Button size="$2" icon={<RefreshCw size={14} />} onPress={() => reset()}>
              Try again
            </Button>
          ) : null}
          <Button
            size="$2"
            chromeless={!chunk}
            icon={<RefreshCw size={14} />}
            onPress={() => { if (typeof window !== 'undefined') window.location.reload() }}
          >
            Reload
          </Button>
        </XStack>
      </Card>
    </YStack>
  )
}
