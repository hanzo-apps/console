'use client'

/**
 * ProductErrorBoundary — the ONE boundary that keeps a single product module's
 * client-render throw from white-screening the whole console.
 *
 * Product modules mount client-only under the catch-all route, so before this
 * boundary a throw in any module (a data edge case, a `ChunkLoadError` from a
 * rolling deploy, a future regression) bubbled to Next's root fallback and
 * replaced everything with "Application error: a client-side exception has
 * occurred" — the shell, the nav, and the URL gone. Wrapped, the shell and nav
 * survive and only the content region shows an honest, retryable card. One
 * boundary in the catch-all closes the class for every product route (DRY).
 *
 * Decisions live in the pure, unit-tested `boundary-logic`; this class only wires
 * them to React lifecycle + the browser (reload/sessionStorage).
 */
import { Component, type ErrorInfo, type ReactNode } from 'react'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { RefreshCw, TriangleAlert } from '@hanzogui/lucide-icons-2'

import { reportError } from '~/lib/event'
import { isChunkLoadError, isNextControlFlowError, shouldReloadForChunk, CHUNK_RELOAD_AT_KEY } from './boundary-logic'

function reloadPage(): void {
  if (typeof window !== 'undefined') window.location.reload()
}

type Props = {
  children: ReactNode
  /** Changing this (the route slug) clears a prior crash on navigation. */
  resetKey?: string
}
type State = { error: Error | null }

export class ProductErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Control flow (notFound/redirect) is re-thrown in render — never a "crash".
    if (isNextControlFlowError(error)) return
    // Surface for triage; never swallowed.
    console.error('[console] product route crashed:', error)
    // A chunk skew is a stale-deploy artifact that self-heals with a reload — not an
    // app bug, so recover and don't report it as an error.
    if (isChunkLoadError(error)) {
      this.recoverFromChunkSkew()
      return
    }
    // React swallows render errors before window.onerror, so a boundary is the ONLY
    // place they reach the ONE error stream.
    reportError(error, { componentStack: info.componentStack, boundary: 'product' })
  }

  componentDidUpdate(prev: Props): void {
    // A fresh route mounts fresh — clear a prior route's error on navigation.
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.reset()
  }

  private reset = (): void => this.setState({ error: null })

  /** Reload once per window to pick up the shipped chunks; never loop. */
  private recoverFromChunkSkew(): void {
    if (typeof window === 'undefined') return
    try {
      const raw = window.sessionStorage.getItem(CHUNK_RELOAD_AT_KEY)
      const last = raw ? Number(raw) : null
      if (shouldReloadForChunk(Date.now(), last)) {
        window.sessionStorage.setItem(CHUNK_RELOAD_AT_KEY, String(Date.now()))
        window.location.reload()
      }
    } catch {
      // sessionStorage blocked (private mode) — fall through to the manual card.
    }
  }

  render(): ReactNode {
    const { error } = this.state
    if (!error) return this.props.children
    // notFound()/redirect() are Next control flow — re-throw so Next handles them.
    if (isNextControlFlowError(error)) throw error

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
              ? 'A newer version of the console just shipped. Reload to load the latest — the rest of the console keeps working.'
              : 'The rest of the console still works. Try again, or reload the page. If it keeps happening, this surface will be looked at.'}
          </Text>
          <XStack gap="$2">
            {!chunk ? (
              <Button size="$2" icon={<RefreshCw size={14} />} onPress={this.reset}>
                Try again
              </Button>
            ) : null}
            <Button size="$2" chromeless={!chunk} icon={<RefreshCw size={14} />} onPress={reloadPage}>
              Reload
            </Button>
          </XStack>
        </Card>
      </YStack>
    )
  }
}
