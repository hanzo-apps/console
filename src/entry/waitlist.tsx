'use client'

/**
 * Waitlist — the `waitlist` stage view. Signup is open (anyone has an account); reaching
 * the PRODUCT is gated on a waitlist position. The entry resolves the access verdict
 * (fail-OPEN — a blip never traps a signed-in user) and hands this view the status +
 * reload; while the check is in flight it shows a loader, otherwise the waitlist panel —
 * the user's position + the two ways to MOVE UP:
 *   1. Run a hanzod node (contribute compute → jump the line / instant access).
 *   2. Invite friends (each referred signup raises your position).
 *
 * The verdict comes from the server (`/auth/waitlist` → the waitlist plugin), the ONE
 * source shared by console, chat and app. Operators (an admin host / a SuperAdmin) never
 * reach this stage — the resolver bypasses the consumer waitlist for them.
 */
import { useCallback, useState, type ReactNode } from 'react'
import { Anchor, Button, Card, Input, Text, XStack, YStack } from '@hanzo/gui'
import { ArrowUp, Check, Copy, RefreshCw, Share2, Terminal, Users } from '@hanzogui/lucide-icons-2'

import { branding } from '~/config'
import { HanzoMark, Loader } from '~/components/ui/Loader'
import { PrimaryButton } from '~/components/ui/PrimaryButton'
import { useSession } from '~/lib/auth/session'
import { type WaitlistStatus } from '~/lib/auth/waitlist'

/** The node one-liner + docs — env-overridable, honest defaults to hanzo.network. */
const NODE_CMD = process.env.NEXT_PUBLIC_HANZOD_INSTALL ?? 'curl -fsSL https://hanzo.network/up | sh'
const NODE_URL = process.env.NEXT_PUBLIC_HANZOD_URL ?? 'https://hanzo.network'

function useCopy(): { copied: boolean; copy: (text: string) => void } {
  const [copied, setCopied] = useState(false)
  const copy = useCallback((text: string) => {
    try {
      void navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable — the value is still selectable in the field */
    }
  }, [])
  return { copied, copy }
}

function nf(n: number): string {
  return new Intl.NumberFormat().format(Math.max(0, Math.floor(n)))
}

/** The referral link a user shares — their refCode on the brand origin. */
function shareLink(refCode: string): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  return refCode ? `${origin}/?ref=${refCode}` : origin
}

function CopyField({ value, label }: { value: string; label: string }) {
  const { copied, copy } = useCopy()
  return (
    <XStack gap="$2" items="center" flexWrap="wrap">
      {/* Read-only but selectable (readOnly DOM attr, RNW passthrough — same pattern
          the sign-in form uses for `type`); a no-op onChangeText keeps it controlled. */}
      <Input flex={1} minW={220} size="$3" value={value} onChangeText={() => {}} {...{ readOnly: true }} />
      <Button
        size="$3"
        theme={copied ? 'green' : undefined}
        icon={copied ? <Check size={15} /> : <Copy size={15} />}
        onPress={() => copy(value)}
        aria-label={label}
      >
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </XStack>
  )
}

function MoveUpCard({
  icon,
  title,
  desc,
  children,
}: {
  icon: ReactNode
  title: string
  desc: string
  children: ReactNode
}) {
  return (
    <Card p="$4" gap="$3" borderWidth={1} borderColor="$borderColor" bg="$color2">
      <XStack gap="$2.5" items="center">
        {icon}
        <YStack flex={1}>
          <Text fontSize="$5" fontWeight="700" color="$color12">
            {title}
          </Text>
          <Text fontSize="$2" color="$color10">
            {desc}
          </Text>
        </YStack>
      </XStack>
      {children}
    </Card>
  )
}

function WaitlistPanel({ status, onRefresh }: { status: WaitlistStatus | null; onRefresh: () => void }) {
  const { signOut } = useSession()
  const rank = status?.rank ?? 0
  const total = status?.total ?? 0
  const aheadOf = status?.aheadOf ?? 0
  const referralCount = status?.referralCount ?? 0
  const refCode = status?.refCode ?? ''
  const link = shareLink(refCode)
  const tweet = `https://twitter.com/intent/tweet?text=${encodeURIComponent(
    `I'm on the ${branding.name} waitlist — join me and jump the line:`,
  )}&url=${encodeURIComponent(link)}`
  const linkedin = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(link)}`

  return (
    <YStack flex={1} minH="100vh" items="center" justify="center" p="$4">
      <YStack width={560} maxW="100%" gap="$4">
        <YStack items="center" gap="$3">
          <HanzoMark size={40} />
          <YStack items="center" gap="$1">
            <Text fontSize="$8" fontWeight="800" color="$color12">
              You're on the list
            </Text>
            <Text fontSize="$3" color="$color11" text="center">
              {branding.name} access is rolling out by waitlist position. Move up by
              contributing compute or inviting friends.
            </Text>
          </YStack>
        </YStack>

        {rank > 0 ? (
          <Card p="$4" borderWidth={1} borderColor="$borderColor" bg="$color1">
            <XStack items="center" justify="space-between" flexWrap="wrap" gap="$3">
              <YStack>
                <Text fontSize="$2" color="$color10">
                  Your position
                </Text>
                <Text fontSize="$10" fontWeight="900" color="$color12">
                  #{nf(rank)}
                </Text>
                <Text fontSize="$2" color="$color10">
                  of {nf(total)} · {nf(aheadOf)} behind you
                </Text>
              </YStack>
              <Button size="$3" icon={<RefreshCw size={15} />} onPress={onRefresh}>
                Refresh
              </Button>
            </XStack>
          </Card>
        ) : null}

        <MoveUpCard
          icon={<Terminal size={22} />}
          title="Jump the line — run a node"
          desc="Boot a cloud fragment. Your hanzod node contributes compute to hanzo.network and earns you instant access."
        >
          <CopyField value={NODE_CMD} label="Copy the node install command" />
          <Anchor href={NODE_URL} target="_blank" rel="noreferrer" fontSize="$2" color="$color11">
            Learn about running a node →
          </Anchor>
        </MoveUpCard>

        <MoveUpCard
          icon={<Users size={22} />}
          title="Invite friends"
          desc={`Each friend who joins with your link moves you up. ${nf(referralCount)} referral${referralCount === 1 ? '' : 's'} so far.`}
        >
          <CopyField value={link} label="Copy your referral link" />
          <XStack gap="$2" flexWrap="wrap">
            <Anchor href={tweet} target="_blank" rel="noreferrer">
              <Button size="$3" icon={<Share2 size={15} />}>
                Share on X
              </Button>
            </Anchor>
            <Anchor href={linkedin} target="_blank" rel="noreferrer">
              <Button size="$3" icon={<ArrowUp size={15} />}>
                Share on LinkedIn
              </Button>
            </Anchor>
          </XStack>
        </MoveUpCard>

        <XStack justify="center" gap="$3" mt="$2">
          <PrimaryButton size="$3" icon={<RefreshCw size={15} />} onPress={onRefresh}>
            Check my access
          </PrimaryButton>
          <Button size="$3" chromeless onPress={() => void signOut()}>
            Sign out
          </Button>
        </XStack>
      </YStack>
    </YStack>
  )
}

export function Waitlist({
  status,
  loading,
  onReload,
}: {
  status: WaitlistStatus | null
  loading: boolean
  onReload: () => void
}) {
  if (loading) return <Loader />
  return <WaitlistPanel status={status} onRefresh={onReload} />
}
