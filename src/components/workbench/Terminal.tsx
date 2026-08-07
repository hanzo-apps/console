'use client'

/**
 * The cloud shell — a REAL terminal in the Developers dock.
 *
 * What was here before was an explorer: a prompt that took `GET /v1/models` and
 * printed the response. It looked like a shell and answered like a form, and the
 * gap between the two is the whole reason this exists — there was no way to run
 * anything, so the `$` in the dock was a promise the dock could not keep.
 *
 * THE SHELL IS A SANDBOX. Not a simulator, not a command allow-list: a login
 * shell on a pseudo-terminal inside the org's own gVisor pod, reached through
 * `/v1/sandboxes/:id/terminal/ws`. Whatever the sandbox image carries — the hanzo
 * CLI included — is a command the user types, and nothing here decides what is
 * allowed to run. That decision belongs to the runtime boundary the pod already
 * has, and putting a second one in a browser tab would only be a fiction.
 *
 * THE SOCKET LEAVES THE ORIGIN, once, deliberately. Every other read in the
 * console goes through the same-origin `/v1` proxy, which mints a user-bound
 * bearer server-side. A WebSocket cannot use it: the proxy is a Next route
 * handler and a route handler forwards requests, not upgrades. So the two halves
 * split — the ticket is fetched through the proxy exactly like every other call,
 * and the socket dials the API host carrying it. That is what a single-use,
 * thirty-second ticket is FOR, and it is why nothing long-lived is ever put in
 * this URL.
 */

import '@xterm/xterm/css/xterm.css'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button, Text, XStack, YStack } from '@hanzo/gui'

import { ApiError, cloudProxyV1Url, restGet, restPost } from '~/lib/api/client'
import { config } from '~/config'
import { toneColor } from '~/components/ui/tone'
import { resize, socketFor } from './logic'

/**
 * The project the dock's shell holds. A `dev` sandbox is attached to a project
 * and the project names the VOLUME, so this constant is what makes the shell the
 * same shell tomorrow: the checkout and the caches are still there when the lease
 * has long since ended. One live sandbox per project is the server's rule, which
 * is also why reopening the dock finds the running one instead of leasing a
 * second.
 */
const PROJECT = 'console'

type Phase = 'starting' | 'live' | 'gone'

type Sandbox = { id: string; status: string; project?: string }

/**
 * The org's running dock sandbox, or a freshly leased one.
 *
 * Asking the server which one is live is what makes the shell survive a reload
 * without remembering anything: there is exactly one live sandbox per project by
 * the server's own rule, so the answer to "which one is mine" is a query and
 * never a stored id that can go stale. The match is re-checked here rather than
 * trusted from the query string — a filter is the server's convenience, and the
 * sandbox this reattaches to had better be the right one.
 */
async function sandbox(): Promise<Sandbox> {
  const live = await restGet<{ sandboxes?: Sandbox[] }>(
    cloudProxyV1Url(`sandboxes?project=${PROJECT}&status=running`),
  )
  const held = live.sandboxes?.find((m) => m.status === 'running' && m.project === PROJECT)
  if (held) return held
  return restPost<Sandbox>(cloudProxyV1Url('sandboxes'), { class: 'dev', project: PROJECT })
}

const reason = (err: unknown): string =>
  err instanceof ApiError
    ? `${err.message}${err.status ? ` (${err.status})` : ''}`
    : err instanceof Error
      ? err.message
      : String(err)

export function Terminal() {
  const [phase, setPhase] = useState<Phase>('starting')
  const [why, setWhy] = useState('')
  // A change to this is the ONE way a session restarts: the effect below owns
  // the whole lifetime — sandbox, ticket, socket, terminal — and reruns as a
  // unit, so there is no half-torn-down session to reason about.
  const [attempt, setAttempt] = useState(0)
  const host = useRef<HTMLDivElement>(null)

  const retry = useCallback(() => {
    setPhase('starting')
    setWhy('')
    setAttempt((n) => n + 1)
  }, [])

  useEffect(() => {
    const mount = host.current
    if (!mount) return

    // `alive` is the barrier for everything this effect started. React mounts an
    // effect twice in development, and a socket opened by the first pass would
    // otherwise keep writing into a terminal the second pass has replaced.
    let alive = true
    let socket: WebSocket | null = null
    let stop: (() => void) | null = null

    const end = (message: string) => {
      if (!alive) return
      setWhy(message)
      setPhase('gone')
    }

    void (async () => {
      try {
        const m = await sandbox()
        if (!alive) return
        const pass = await restPost<{ ticket: string }>(cloudProxyV1Url(`sandboxes/${m.id}/terminal`))
        if (!alive) return

        // xterm is loaded HERE and not imported at the top, because it reads
        // `document` as it constructs and this component is rendered on the
        // server first. A dynamic import is the honest form of "only in a
        // browser" — the alternative is a build-time flag that says the same
        // thing further from the code that needs it.
        const [{ Terminal: Xterm }, { FitAddon }] = await Promise.all([
          import('@xterm/xterm'),
          import('@xterm/addon-fit'),
        ])
        if (!alive) return

        // No theme override. A terminal is its own surface and xterm's default
        // one is the convention everywhere else a person has ever used a shell;
        // tinting it to the dock's palette would make a light theme's terminal
        // the one place in the product where ANSI colors are unreadable.
        const term = new Xterm({
          cursorBlink: true,
          fontFamily: "'Geist Mono', ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
          fontSize: 12,
          scrollback: 5000,
        })
        const fit = new FitAddon()
        term.loadAddon(fit)
        term.open(mount)

        const ws = new WebSocket(socketFor(config.apiUrl, m.id, pass.ticket))
        ws.binaryType = 'arraybuffer'
        socket = ws

        // The window, sent whenever it changes and once at the start. A shell
        // that is never told its size runs at the 80x24 the pty defaults to,
        // and every full-screen program in it draws into the wrong rectangle.
        const measure = () => {
          try {
            fit.fit()
          } catch {
            return // the dock is collapsed and the element has no size yet
          }
          if (ws.readyState === WebSocket.OPEN) ws.send(resize(term.cols, term.rows))
        }
        const watch = new ResizeObserver(measure)
        watch.observe(mount)

        ws.onopen = () => {
          if (!alive) return
          setPhase('live')
          measure()
          term.focus()
        }
        ws.onmessage = (e) => {
          term.write(
            typeof e.data === 'string' ? e.data : new Uint8Array(e.data as ArrayBuffer),
          )
        }
        ws.onerror = () => end('The connection failed.')
        ws.onclose = (e) => end(e.reason || 'The connection closed.')

        term.onData((d) => {
          if (ws.readyState === WebSocket.OPEN) ws.send(d)
        })

        stop = () => {
          watch.disconnect()
          ws.onclose = null
          ws.onerror = null
          ws.close()
          term.dispose()
        }
      } catch (err) {
        end(reason(err))
      }
    })()

    return () => {
      alive = false
      if (stop) stop()
      else socket?.close()
    }
  }, [attempt])

  // The terminal's element is ALWAYS laid out, and the status covers it rather
  // than replacing it. An element that is display:none has no size, and the fit
  // that runs the moment the socket opens would measure zero and hand the shell
  // an 80x24 window it never corrects.
  return (
    <YStack flex={1} minH={0} position="relative" bg="#000">
      <div ref={host} style={{ position: 'absolute', inset: 0, padding: 8 }} />
      {phase === 'live' ? null : (
        <YStack position="absolute" t={0} l={0} r={0} b={0} items="center" justify="center" gap="$2" p="$4" bg="$color1">
          {phase === 'starting' ? (
            <Text fontSize="$2" color="$color10">
              Starting your cloud shell…
            </Text>
          ) : (
            <>
              <XStack items="center" gap="$2">
                <Text fontSize="$2" color={toneColor('critical')}>
                  Disconnected
                </Text>
                <Button size="$2" onPress={retry} aria-label="Reconnect the cloud shell">
                  Reconnect
                </Button>
              </XStack>
              {why ? (
                <Text fontSize="$1" color="$color10" className="hz-mono">
                  {why}
                </Text>
              ) : null}
            </>
          )}
        </YStack>
      )}
    </YStack>
  )
}
