'use client'

/**
 * Authors — the customer OSS-author royalty screen over the REAL cloud
 * `/v1/authors` surface (cloud `clients/authors`). Two states, one module:
 *  - NOT enrolled → a "Connect GitHub" card + a plain-English explainer of the
 *    OSS Author program.
 *  - Enrolled → a dashboard: connection status + GitHub identity + share rate,
 *    four real stat tiles (verified repos / accrued / pending / paid), your
 *    repositories (verify + copy the "Deploy on Hanzo" badge), the verify-by-file
 *    recipe, the deploys of your work, and your payout history. Every value is real
 *    or an honest empty/`—`; states are loading / BackendStateCard / honest empty —
 *    never a fabricated row. Org-scoped SERVER-SIDE (the `/v1` bearer proxy); no
 *    credential in the browser.
 */
import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import {
  BadgeCheck,
  BookOpen,
  Check,
  Coins,
  Copy,
  FileCode,
  Github,
  HandCoins,
  RefreshCw,
  Rocket,
  ShieldCheck,
  Wallet,
} from '@hanzogui/lucide-icons-2'

import { AuthorsApi, type AuthorOverview } from '~/lib/api/authors'
import { MetricCard } from '~/components/ui/Metric'
import { payoutMethodLabel, sharePct, shortDate, statusLabel, statusColor, usd, verifyMethodLabel } from './authors/logic'
import { toneColor } from '~/components/ui/tone'
import { BackendStateCard, FieldRow, FieldText, PageHeader, PrimaryButton, classifyBackend, type BackendState } from '@hanzo/ui/product'

type Async<T> =
  | { phase: 'loading' }
  | { phase: 'error'; error: BackendState }
  | { phase: 'ready'; data: T }

export function AuthorsModule() {
  const [state, setState] = useState<Async<AuthorOverview>>({ phase: 'loading' })
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  const load = useCallback(() => {
    setState({ phase: 'loading' })
    AuthorsApi.overview()
      .then((data) => setState({ phase: 'ready', data }))
      .catch((e) => setState({ phase: 'error', error: classifyBackend(e) }))
  }, [])
  useEffect(() => {
    load()
  }, [load])

  const copy = useCallback((key: string, text: string) => {
    try {
      void navigator.clipboard?.writeText(text)
    } catch {
      /* clipboard may be unavailable — the text is selectable in the field */
    }
    setCopiedKey(key)
    setTimeout(() => setCopiedKey(null), 1500)
  }, [])

  return (
    <YStack gap="$3">
      <PageHeader
        title="Authors"
        subtitle="Earn when your open-source project is deployed on Hanzo."
        actions={
          <Button size="$3" icon={<RefreshCw size={15} />} onPress={load} disabled={state.phase === 'loading'}>
            Refresh
          </Button>
        }
      />

      {state.phase === 'loading' && <Text color="$color10">Loading your author program…</Text>}
      {state.phase === 'error' && (
        <BackendStateCard state={state.error} onRetry={load} hint="endpoint · GET /v1/authors" />
      )}
      {state.phase === 'ready' &&
        (state.data.isAuthor ? (
          <AuthorDashboard data={state.data} copiedKey={copiedKey} onCopy={copy} onChanged={load} />
        ) : (
          <AuthorConnect onConnected={load} />
        ))}
    </YStack>
  )
}

// ── connect (not yet enrolled) ────────────────────────────────────────────────

function AuthorConnect({ onConnected }: { onConnected: () => void }) {
  const [login, setLogin] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const connect = useCallback(() => {
    setSubmitting(true)
    setError(null)
    AuthorsApi.connect(login.trim())
      .then(() => onConnected())
      .catch((e) => setError(e instanceof Error ? e.message : 'GitHub was not connected. Check the login and try again.'))
      .finally(() => setSubmitting(false))
  }, [login, onConnected])

  return (
    <YStack gap="$3">
      <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor">
        <XStack items="center" gap="$2">
          <Github size={18} color="$color11" />
          <Text fontSize="$5" fontWeight="700">
            Earn an ongoing share of the platform spend of every org that deploys your project
          </Text>
        </XStack>
        <Text fontSize="$3" color="$color11">
          The OSS Author program pays you an ongoing share of the platform spend of every organization that deploys your
          open-source project on Hanzo. Connect GitHub, verify the repositories you own, and earn your share every period —
          for as long as organizations build on your work. New authors are reviewed by our team before earnings begin.
        </Text>
        <YStack gap="$1">
          <FieldRow label="GitHub login (optional)">
            <FieldText
              value={login}
              onChange={setLogin}
              disabled={submitting}
              placeholder="your-github-username — used if we can't detect a linked GitHub account"
            />
          </FieldRow>
          <Text fontSize="$1" color="$color10">
            Leave blank and we’ll use the GitHub account linked to your Hanzo login.
          </Text>
        </YStack>
        {error ? (
          <Text fontSize="$2" color={toneColor('critical')}>
            {error}
          </Text>
        ) : null}
        <XStack>
          <PrimaryButton size="$3" icon={<Github size={15} />} onPress={connect} disabled={submitting}>
            {submitting ? 'Connecting…' : 'Connect GitHub'}
          </PrimaryButton>
        </XStack>
      </Card>

      <XStack gap="$3" flexWrap="wrap">
        <HowTile n="1" icon={<Github size={15} color="$color11" />} title="Connect GitHub" body="Link your GitHub account to claim the projects you author." />
        <HowTile n="2" icon={<ShieldCheck size={15} color="$color11" />} title="Verify a repo" body="Prove you own a repository with the Hanzo GitHub app or a hanzo.json file." />
        <HowTile n="3" icon={<Rocket size={15} color="$color11" />} title="Earn when it deploys" body="Every org that deploys your work earns you a share of their spend, every period." />
      </XStack>
    </YStack>
  )
}

function HowTile({ n, icon, title, body }: { n: string; icon: ReactElement; title: string; body: string }) {
  return (
    <Card flex={1} minW={200} p="$3.5" gap="$1.5" borderWidth={1} borderColor="$borderColor">
      <XStack items="center" gap="$2">
        <YStack width={22} height={22} rounded="$10" bg="$color3" items="center" justify="center">
          <Text fontSize="$2" fontWeight="700" color="$color11">
            {n}
          </Text>
        </YStack>
        <XStack items="center" gap="$1.5">
          {icon}
          <Text fontSize="$3" fontWeight="700" color="$color12">
            {title}
          </Text>
        </XStack>
      </XStack>
      <Text fontSize="$2" color="$color10">
        {body}
      </Text>
    </Card>
  )
}

// ── dashboard (enrolled) ──────────────────────────────────────────────────────

function AuthorDashboard({
  data,
  copiedKey,
  onCopy,
  onChanged,
}: {
  data: AuthorOverview
  copiedKey: string | null
  onCopy: (key: string, text: string) => void
  onChanged: () => void
}) {
  const verifiedRepos = data.repos.filter((r) => r.verified).length
  return (
    <YStack gap="$3">
      {/* Status */}
      <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor">
        <XStack items="center" gap="$2" justify="space-between" flexWrap="wrap">
          <XStack items="center" gap="$2">
            <Github size={18} color={statusColor(data.status)} />
            <Text fontSize="$5" fontWeight="700">
              Author
            </Text>
            {data.verified ? (
              <XStack items="center" gap="$1">
                <BadgeCheck size={16} color={toneColor('positive')} />
                <Text fontSize="$2" color={toneColor('positive')}>
                  verified identity
                </Text>
              </XStack>
            ) : null}
          </XStack>
          <Text fontSize="$2" fontWeight="700" color={statusColor(data.status)}>
            {statusLabel(data.status)}
          </Text>
        </XStack>

        {data.githubLogin ? (
          <Text fontSize="$2" color="$color10">
            GitHub: <Text style={{ fontFamily: 'monospace' }} color="$color12">@{data.githubLogin}</Text>
          </Text>
        ) : null}

        {/* The real royalty rate — a muted DASHBOARD detail for the enrolled author,
            deliberately NOT in any hero/CTA copy (the CTO cut the public "earn X%"). */}
        <Text fontSize="$2" color="$color10">
          Your rate: <Text color="$color12" fontWeight="700">{sharePct(data.shareBps)}</Text> of a deploying org's platform spend.
        </Text>

        {data.status === 'connected' ? (
          <Text fontSize="$3" color="$color11">
            Your account is pending approval — verify repos now; earnings start once staff approve you.
          </Text>
        ) : data.status === 'suspended' ? (
          <Text fontSize="$3" color="$color11">
            Your author account is suspended, so new deploys of your work no longer accrue. Any royalties you’ve already
            earned are unaffected. Contact support to reactivate.
          </Text>
        ) : (
          <Text fontSize="$3" color="$color11">
            You’re approved. Every org that deploys your verified repositories earns you a share of their
            spend, every period.
          </Text>
        )}
      </Card>

      {/* Real stat tiles */}
      <XStack gap="$3" flexWrap="wrap">
        <MetricCard icon={<Github size={16} color={toneColor('muted')} />} label="Repos" value={String(verifiedRepos)} caption="verified repositories" />
        <MetricCard icon={<HandCoins size={16} color="$color11" />} label="Accrued" value={usd(data.accruedCents)} caption="lifetime royalties" />
        <MetricCard icon={<Coins size={16} color={toneColor('warning')} />} label="Pending" value={usd(data.pendingCents)} caption="awaiting payout" />
        <MetricCard icon={<Wallet size={16} color={toneColor('positive')} />} label="Paid out" value={usd(data.paidCents)} caption="royalties paid" />
      </XStack>

      {/* Repositories */}
      <RepositoriesCard data={data} copiedKey={copiedKey} onCopy={onCopy} onChanged={onChanged} />

      {/* Verify by file */}
      <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor">
        <XStack items="center" gap="$2">
          <FileCode size={16} color="$color11" />
          <Text fontSize="$4" fontWeight="700">
            Verify by file
          </Text>
        </XStack>
        <Text fontSize="$2" color="$color11">
          Add this <Text style={{ fontFamily: 'monospace' }}>{data.verifyFile}</Text> to your repo’s default branch, or
          grant the Hanzo GitHub app, then Verify. Your code: <Text style={{ fontFamily: 'monospace' }}>{data.verifyCode || '—'}</Text>
        </Text>
        {data.verifySnippet ? (
          <XStack gap="$2" items="flex-start" flexWrap="wrap">
            <Card flex={1} minW={240} px="$3" py="$2.5" bg="$color2" borderWidth={1} borderColor="$borderColor" rounded="$3">
              <Text style={{ fontFamily: 'monospace', whiteSpace: 'pre-wrap' }} fontSize="$2" color="$color12">
                {data.verifySnippet}
              </Text>
            </Card>
            <Button
              size="$3"
              icon={copiedKey === 'snippet' ? <Check size={15} /> : <Copy size={15} />}
              onPress={() => onCopy('snippet', data.verifySnippet)}
            >
              {copiedKey === 'snippet' ? 'Copied' : 'Copy'}
            </Button>
          </XStack>
        ) : null}
      </Card>

      {/* Deploys */}
      <Card p="$0" borderWidth={1} borderColor="$borderColor" overflow="hidden">
        <XStack px="$4" py="$3" borderBottomWidth={1} borderColor="$borderColor">
          <Text fontSize="$4" fontWeight="700">
            Deploys of your work
          </Text>
        </XStack>
        {data.deploys.length === 0 ? (
          <YStack p="$5" items="center" gap="$2">
            <Rocket size={22} color={toneColor('muted')} />
            <Text fontSize="$3" color="$color11">
              No deploys yet
            </Text>
            <Text fontSize="$2" color="$color10">
              Share your “Deploy on Hanzo” badge — deploys of your work show up here.
            </Text>
          </YStack>
        ) : (
          <YStack>
            {data.deploys.map((d, i) => (
              <XStack
                key={`${d.repoUrl}-${d.deployingOrg}-${i}`}
                px="$4"
                py="$3"
                items="center"
                justify="space-between"
                gap="$3"
                borderBottomWidth={1}
                borderColor="$borderColor"
                flexWrap="wrap"
              >
                <YStack gap="$1" flex={1} minW={180}>
                  <Text style={{ fontFamily: 'monospace' }} fontSize="$3" fontWeight="600" color="$color12">
                    {d.repoUrl}
                  </Text>
                  <Text fontSize="$2" color="$color10">
                    {d.deployingOrg || '—'}
                    {d.project ? ` · ${d.project}` : ''}
                  </Text>
                </YStack>
                <Text fontSize="$2" color="$color10" minW={90} text="right">
                  {shortDate(d.createdAt)}
                </Text>
              </XStack>
            ))}
          </YStack>
        )}
      </Card>

      {/* Payout history */}
      <Card p="$0" borderWidth={1} borderColor="$borderColor" overflow="hidden">
        <XStack px="$4" py="$3" borderBottomWidth={1} borderColor="$borderColor">
          <Text fontSize="$4" fontWeight="700">
            Payout history
          </Text>
        </XStack>
        {data.payouts.length === 0 ? (
          <YStack p="$5" items="center" gap="$2">
            <Wallet size={22} color={toneColor('muted')} />
            <Text fontSize="$3" color="$color11">
              No payouts yet
            </Text>
            <Text fontSize="$2" color="$color10">
              Royalties are paid out by our team once they accrue. They’ll show up here.
            </Text>
          </YStack>
        ) : (
          <YStack>
            {data.payouts.map((p) => (
              <XStack
                key={p.id}
                px="$4"
                py="$3"
                items="center"
                justify="space-between"
                gap="$3"
                borderBottomWidth={1}
                borderColor="$borderColor"
                flexWrap="wrap"
              >
                <YStack gap="$1" flex={1} minW={180}>
                  <Text fontSize="$3" fontWeight="600" color="$color12">
                    {payoutMethodLabel(p.method)}
                    {p.reference ? (
                      <Text fontSize="$2" color="$color10">
                        {' '}
                        · {p.reference}
                      </Text>
                    ) : null}
                  </Text>
                  <Text fontSize="$2" color="$color10">
                    {shortDate(p.createdAt)}
                  </Text>
                </YStack>
                <Text fontSize="$3" fontWeight="700" color="$color12" minW={72} text="right">
                  {usd(p.amountCents)}
                </Text>
              </XStack>
            ))}
          </YStack>
        )}
      </Card>
    </YStack>
  )
}

function RepositoriesCard({
  data,
  copiedKey,
  onCopy,
  onChanged,
}: {
  data: AuthorOverview
  copiedKey: string | null
  onCopy: (key: string, text: string) => void
  onChanged: () => void
}) {
  const [repoUrl, setRepoUrl] = useState('')
  const [verifying, setVerifying] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const verify = useCallback(() => {
    const url = repoUrl.trim()
    if (!url) return
    setVerifying(true)
    setError(null)
    AuthorsApi.verifyRepo(url)
      .then(() => {
        setRepoUrl('')
        onChanged()
      })
      // Surface the server message on 400 (malformed / connect-first), 409 (owned by
      // another author), 422 (could-not-verify) — honest, never a fabricated success.
      .catch((e) => setError(e instanceof Error ? e.message : 'That repository was not verified. It has to be owned by your connected GitHub account, or carry a hanzo.json file.'))
      .finally(() => setVerifying(false))
  }, [repoUrl, onChanged])

  return (
    <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor">
      <XStack items="center" gap="$2">
        <BookOpen size={16} color="$color11" />
        <Text fontSize="$4" fontWeight="700">
          Your repositories
        </Text>
      </XStack>

      <XStack gap="$2" items="flex-start" flexWrap="wrap">
        <YStack flex={1} minW={240}>
          <FieldText
            value={repoUrl}
            onChange={setRepoUrl}
            disabled={verifying}
            placeholder="https://github.com/you/your-project"
          />
        </YStack>
        <PrimaryButton size="$3" icon={<ShieldCheck size={15} />} onPress={verify} disabled={verifying || !repoUrl.trim()}>
          {verifying ? 'Verifying…' : 'Verify a repo'}
        </PrimaryButton>
      </XStack>
      {error ? (
        <Text fontSize="$2" color={toneColor('critical')}>
          {error}
        </Text>
      ) : null}

      {data.repos.length === 0 ? (
        <YStack py="$4" items="center" gap="$1">
          <Text fontSize="$3" color="$color11">
            No repositories yet
          </Text>
          <Text fontSize="$2" color="$color10">
            Verify one to start earning.
          </Text>
        </YStack>
      ) : (
        <YStack gap="$2">
          {data.repos.map((r) => (
            <XStack
              key={r.repoUrl}
              px="$3"
              py="$2.5"
              items="center"
              justify="space-between"
              gap="$3"
              borderWidth={1}
              borderColor="$borderColor"
              rounded="$3"
              bg="$color2"
              flexWrap="wrap"
            >
              <YStack gap="$1" flex={1} minW={200}>
                <Text style={{ fontFamily: 'monospace' }} fontSize="$3" color="$color12">
                  {r.repoUrl}
                </Text>
                {r.verified ? (
                  <XStack items="center" gap="$1">
                    <BadgeCheck size={13} color={toneColor('positive')} />
                    <Text fontSize="$2" color={toneColor('positive')}>
                      {verifyMethodLabel(r.method)}
                    </Text>
                  </XStack>
                ) : (
                  <Text fontSize="$2" color={toneColor('warning')}>
                    Unverified
                  </Text>
                )}
              </YStack>
              <Button
                size="$2"
                icon={copiedKey === r.repoUrl ? <Check size={13} /> : <Copy size={13} />}
                onPress={() => onCopy(r.repoUrl, r.badgeMarkdown)}
                disabled={!r.badgeMarkdown}
              >
                {copiedKey === r.repoUrl ? 'Copied' : 'Copy badge'}
              </Button>
            </XStack>
          ))}
        </YStack>
      )}
    </Card>
  )
}
