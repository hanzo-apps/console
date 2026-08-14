'use client'

/**
 * Bots — LAUNCH + WATCH a computer-using bot.
 *
 * This is the CUSTOMER surface over cloud `POST /v1/bots/run` (BotsApi.run): boot a
 * desktop or terminal computer, run a computer-using agent ("bot") on it against a
 * task, and WATCH/ATTACH it live over the VNC session the launch returns. Every
 * launch is GATED + METERED a flat per-run "bot" fee on the org's commerce ledger
 * (server-side, from the minted user bearer) — an unfunded org gets a 402 and the
 * add-funds nudge below.
 *
 * Distinct from its two siblings, deliberately: `BotModule` (id `bot`) is the agent
 * GATEWAY status/deep-links; `BotsModule` (id `bots`, admin) is the cross-tenant
 * fleet-SPEND analytics. This one is the per-org "run a bot on a computer" console.
 *
 * VNC EMBED: the returned `sessionUrl` points at the bot gateway (bot.hanzo.ai
 * /vnc?nodeId=<runId>). It renders in an <iframe> here; because the bot UI is
 * IAM-gated to its own origins, the gateway must allow this console origin as a
 * `frame-ancestors` — until it does, the "Open in a new tab" fallback always works.
 *
 * SCOPE: launch + watch + manage. The launch form + VNC attach are unchanged; on top of
 * them the runs list is now the REAL org fleet off `GET /v1/bots` (BotsApi.list) with a
 * refresh control, and each run can be halted with `POST /v1/bots/:runId/stop`
 * (BotsApi.stop). If the list endpoint isn't deployed yet the view degrades to launch-only
 * (this session's launches, held client-side) with a subtle note — never a hard error.
 */
import { useCallback, useEffect, useState } from 'react'
import { Button, Card, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { Bot, Cpu, ExternalLink, Monitor, Play, RefreshCw, Square, Terminal } from '@hanzogui/lucide-icons-2'

import { ApiError } from '~/lib/api'
import { BotsApi, type BotRunRow, type BotSurface } from '~/lib/api/bots'
import { PageHeader, StatusTag } from '@hanzo/ui/product'

/** Statuses a run can't be stopped from — the Stop button is disabled on these. */
const TERMINAL = new Set([
  'stopped',
  'stopping',
  'failed',
  'canceled',
  'cancelled',
  'succeeded',
  'error',
  'done',
  'complete',
  'completed',
  'killed',
])
const isTerminal = (status: string): boolean => TERMINAL.has(status.toLowerCase())

export function BotsConsole() {
  const [task, setTask] = useState('')
  const [surface, setSurface] = useState<BotSurface>('desktop')
  const [gpu, setGpu] = useState(false)
  const [timeout, setTimeoutVal] = useState('')
  const [launching, setLaunching] = useState(false)
  const [err, setErr] = useState<{ message: string; needsFunds: boolean } | null>(null)
  const [runs, setRuns] = useState<BotRunRow[]>([])
  const [active, setActive] = useState<BotRunRow | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(false)
  const [listErr, setListErr] = useState(false)
  const [stoppingId, setStoppingId] = useState<string | null>(null)
  const [stopErr, setStopErr] = useState<string | null>(null)

  // Pull the org's real runs off GET /v1/bots. Server rows are the source of truth, but
  // a just-launched run may not be listed yet (eventual consistency), so local-only runs
  // are kept ahead of them — a quick refresh never makes a fresh launch vanish. A failure
  // (endpoint not deployed) degrades to launch-only: keep existing runs, flag `listErr`.
  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const rows = await BotsApi.list()
      const seen = new Set(rows.map((r) => r.runId))
      setRuns((prev) => [...prev.filter((r) => !seen.has(r.runId)), ...rows])
      setActive((a) => (a ? (rows.find((r) => r.runId === a.runId) ?? a) : a))
      setListErr(false)
    } catch {
      setListErr(true)
    } finally {
      setLoaded(true)
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const stop = useCallback(
    async (runId: string) => {
      if (stoppingId) return
      setStoppingId(runId)
      setStopErr(null)
      try {
        const stopped = await BotsApi.stop(runId)
        const status = stopped.status || 'stopped'
        setRuns((prev) => prev.map((r) => (r.runId === runId ? { ...r, status } : r)))
        setActive((a) => (a && a.runId === runId ? { ...a, status } : a))
      } catch (e) {
        setStopErr(e instanceof Error && e.message ? e.message : 'The bot was not stopped. It is still running — try again.')
      } finally {
        setStoppingId(null)
      }
    },
    [stoppingId],
  )

  const launch = useCallback(async () => {
    const t = task.trim()
    if (!t || launching) return
    setLaunching(true)
    setErr(null)
    try {
      const run = await BotsApi.run({ task: t, surface, gpu, timeout: timeout.trim() || undefined })
      const launched: BotRunRow = { ...run, task: t, surface, startedAt: Date.now() }
      setRuns((prev) => [launched, ...prev])
      setActive(launched)
    } catch (e) {
      const status = e instanceof ApiError ? e.status : 0
      setErr({
        message:
          status === 402
            ? 'This launch needs funds. Add credit to your org to run bots.'
            : e instanceof Error && e.message
              ? e.message
              : 'The bot did not launch. Your task is still here — try again.',
        needsFunds: status === 402,
      })
    } finally {
      setLaunching(false)
    }
  }, [task, surface, gpu, timeout, launching])

  return (
    <>
      <PageHeader
        title="Launch a bot"
        subtitle="Boot a computer, run a computer-using bot on it, and watch it live — billed a flat per-run fee to your org."
      />

      <YStack gap="$4" p="$4">
        {/* ── Launch form ─────────────────────────────────────────────────── */}
        <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor">
          <Text fontSize="$3" color="$color11">
            What should the bot do?
          </Text>
          <XStack
            items="center"
            gap="$2"
            px="$3"
            borderWidth={1}
            borderColor="$borderColor"
            rounded="$3"
          >
            <Bot size={16} />
            <input
              value={task}
              onChange={(e) => setTask(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void launch()
              }}
              placeholder="e.g. Open the invoice in the browser and export it as PDF"
              style={{
                flex: 1,
                border: 'none',
                outline: 'none',
                background: 'transparent',
                color: 'inherit',
                padding: '10px 0',
                fontSize: 14,
              }}
            />
          </XStack>

          <XStack gap="$3" flexWrap="wrap" items="center">
            <XStack gap="$2" items="center">
              <Button
                size="$3"
                theme={surface === 'desktop' ? 'light' : undefined}
                chromeless={surface !== 'desktop'}
                icon={<Monitor size={15} />}
                onPress={() => setSurface('desktop')}
              >
                Desktop
              </Button>
              <Button
                size="$3"
                theme={surface === 'terminal' ? 'light' : undefined}
                chromeless={surface !== 'terminal'}
                icon={<Terminal size={15} />}
                onPress={() => setSurface('terminal')}
              >
                Terminal
              </Button>
            </XStack>
            <Button
              size="$3"
              theme={gpu ? 'light' : undefined}
              chromeless={!gpu}
              icon={<Cpu size={15} />}
              onPress={() => setGpu((g) => !g)}
            >
              GPU
            </Button>
            <XStack
              items="center"
              px="$3"
              borderWidth={1}
              borderColor="$borderColor"
              rounded="$3"
              minW={130}
            >
              <input
                value={timeout}
                onChange={(e) => setTimeoutVal(e.target.value)}
                placeholder="timeout (30m)"
                style={{
                  flex: 1,
                  border: 'none',
                  outline: 'none',
                  background: 'transparent',
                  color: 'inherit',
                  padding: '8px 0',
                  fontSize: 13,
                }}
              />
            </XStack>
            <Button
              size="$3"
              theme="light"
              disabled={!task.trim() || launching}
              icon={launching ? <Spinner size="small" /> : <Play size={15} />}
              onPress={() => void launch()}
            >
              {launching ? 'Launching…' : 'Launch bot'}
            </Button>
          </XStack>

          {err ? (
            <XStack gap="$2" items="center">
              <Text fontSize="$2" color="$red10">
                {err.message}
              </Text>
              {err.needsFunds ? (
                <Button size="$2" theme="light" onPress={() => window.open('/billing', '_self')}>
                  Add funds
                </Button>
              ) : null}
            </XStack>
          ) : (
            <Text fontSize="$1" color="$color10">
              A flat per-run fee is billed to your org on launch (set to 0 to make launches free).
            </Text>
          )}
        </Card>

        {/* ── Live view (VNC attach) ──────────────────────────────────────── */}
        {active ? (
          <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor">
            <XStack items="center" justify="space-between" flexWrap="wrap" gap="$2">
              <XStack items="center" gap="$3" flex={1}>
                <StatusTag status={active.status || 'pending'} />
                <YStack>
                  <Text fontSize="$3">{active.task}</Text>
                  <Text fontSize="$1" color="$color10">
                    {active.surface} · {active.runId}
                  </Text>
                </YStack>
              </XStack>
              <Button
                size="$2"
                chromeless
                icon={<ExternalLink size={14} />}
                onPress={() => active.sessionUrl && window.open(active.sessionUrl, '_blank', 'noopener')}
              >
                Open in a new tab
              </Button>
            </XStack>
            {active.sessionUrl ? (
              <YStack
                borderWidth={1}
                borderColor="$borderColor"
                rounded="$4"
                overflow="hidden"
                height={520}
              >
                <iframe
                  key={active.runId}
                  src={active.sessionUrl}
                  title={`bot ${active.runId}`}
                  style={{ width: '100%', height: '100%', border: 'none' }}
                  allow="clipboard-read; clipboard-write; fullscreen"
                />
              </YStack>
            ) : (
              <Text fontSize="$2" color="$color10">
                No session URL returned — the bot gateway may still be booting the machine.
              </Text>
            )}
          </Card>
        ) : null}

        {/* ── Runs — the org's real fleet (GET /v1/bots), with refresh + stop ─── */}
        {loaded || runs.length > 0 ? (
          <Card p="$4" gap="$2" borderWidth={1} borderColor="$borderColor">
            <XStack items="center" justify="space-between" gap="$2">
              <Text fontSize="$2" color="$color11">
                Runs
              </Text>
              <Button
                size="$2"
                chromeless
                disabled={loading}
                icon={loading ? <Spinner size="small" /> : <RefreshCw size={14} />}
                onPress={() => void refresh()}
              >
                Refresh
              </Button>
            </XStack>

            {stopErr ? (
              <Text fontSize="$2" color="$red10">
                {stopErr}
              </Text>
            ) : null}

            {runs.length === 0 ? (
              <Text fontSize="$1" color="$color10">
                {listErr
                  ? 'Live runs aren’t available yet — launch a bot above to get started.'
                  : 'No bots running yet. Launch one above.'}
              </Text>
            ) : (
              <>
                {listErr ? (
                  <Text fontSize="$1" color="$color10">
                    Showing this session’s launches — the live runs list is unavailable.
                  </Text>
                ) : null}
                {runs.map((r) => (
                  <XStack
                    key={r.runId}
                    items="center"
                    justify="space-between"
                    gap="$2"
                    py="$2"
                    borderBottomWidth={1}
                    borderColor="$borderColor"
                  >
                    <XStack items="center" gap="$3" flex={1}>
                      <StatusTag status={r.status || 'pending'} />
                      <YStack flex={1}>
                        <Text fontSize="$2" numberOfLines={1}>
                          {r.task}
                        </Text>
                        <Text fontSize="$1" color="$color10">
                          {r.surface} · {r.runId}
                        </Text>
                      </YStack>
                    </XStack>
                    <XStack items="center" gap="$2">
                      <Button
                        size="$2"
                        chromeless={active?.runId !== r.runId}
                        theme={active?.runId === r.runId ? 'light' : undefined}
                        onPress={() => setActive(r)}
                      >
                        Attach
                      </Button>
                      <Button
                        size="$2"
                        chromeless
                        disabled={stoppingId === r.runId || isTerminal(r.status)}
                        icon={stoppingId === r.runId ? <Spinner size="small" /> : <Square size={13} />}
                        onPress={() => void stop(r.runId)}
                      >
                        Stop
                      </Button>
                    </XStack>
                  </XStack>
                ))}
              </>
            )}
          </Card>
        ) : null}
      </YStack>
    </>
  )
}
