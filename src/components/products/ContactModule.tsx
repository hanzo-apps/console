'use client'

/**
 * Contact — the console's built-in "get help / reach us" surface. A responsive
 * grid of channel cards (support, sales, community, code, models) so a user never
 * has to leave the console to find the right door. The AI chat widget answers
 * in-product; this is the human/channel fallback. Hanzo-branded, hanzo.ai is the hub.
 *
 * Pure presentational + external links — no backend, no auth, always available.
 */
import type { ComponentType } from 'react'
import { Card, Text, XStack, YStack } from '@hanzo/gui'
import {
  Boxes,
  Github,
  Handshake,
  Linkedin,
  MessageCircle,
  MessagesSquare,
  MoreHorizontal,
} from '@hanzogui/lucide-icons-2'

/** The @hanzo/gui lucide icons accept size + themed color. */
type IconProps = { size?: number | string; color?: string }

type Channel = {
  // Lucide icons + the inline XMark; loosened so both satisfy the field.
  icon: ComponentType<any>
  title: string
  body: string
  /** Primary action: an email (mailto:) or an external URL. Omit for "coming soon". */
  href?: string
  cta?: string
}

const CHANNELS: Channel[] = [
  {
    icon: MessagesSquare,
    title: 'Get Product Support',
    body: 'To help us look into it, please share your issue, Account ID, and the time it occurred.',
    href: 'mailto:support@hanzo.ai',
    cta: 'support@hanzo.ai',
  },
  {
    icon: Handshake,
    title: 'Contact Sales',
    body: 'Tell us your needs and our team will be in touch.',
    href: 'mailto:sales@hanzo.ai',
    cta: 'sales@hanzo.ai',
  },
  {
    icon: XMark,
    title: 'Follow Hanzo on X',
    body: 'Get real-time product announcements and tech news.',
    href: 'https://x.com/hanzoai',
    cta: '@hanzoai',
  },
  {
    icon: MessageCircle,
    title: 'Join Our Discord',
    body: 'Chat live with developers and other users from our community.',
    href: 'https://discord.gg/CJCyAsm9Vr',
    cta: 'discord.gg/CJCyAsm9Vr',
  },
  {
    icon: Linkedin,
    title: 'Follow Us on LinkedIn',
    body: 'Get the latest company news and career opportunities.',
    href: 'https://www.linkedin.com/company/hanzoai',
    cta: 'linkedin.com/company/hanzoai',
  },
  {
    icon: Github,
    title: 'Explore Our Code',
    body: 'Find our open-source projects and start contributing today.',
    href: 'https://github.com/hanzoai',
    cta: 'github.com/hanzoai',
  },
  {
    icon: Boxes,
    title: 'Download Our Models',
    body: 'Get instant access to our open-source models on Hugging Face.',
    href: 'https://huggingface.co/hanzoai',
    cta: 'huggingface.co/hanzoai',
  },
  {
    icon: MoreHorizontal,
    title: 'More to Come',
    body: 'We are always opening new doors — check back soon.',
  },
]

/** Hanzo uses lucide throughout; X has no lucide glyph, so an inline mark keeps the
 *  set consistent (currentColor, same 24-box as the lucide icons). */
function XMark(props: IconProps) {
  const { size = 24, ...rest } = props
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden {...rest}>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.66l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231 5.45-6.231Zm-1.161 17.52h1.833L7.084 4.126H5.117l11.966 15.644Z" />
    </svg>
  )
}

export function ContactModule() {
  return (
    <YStack gap="$5" p="$4" $sm={{ p: '$3' }}>
      <YStack gap="$1">
        <Text fontSize="$9" fontWeight="800">
          Contact
        </Text>
        <Text fontSize="$4" color="$color11">
          Ask the in-console assistant for instant answers, or reach the right team below.
        </Text>
      </YStack>

      <XStack flexWrap="wrap" gap="$3.5">
        {CHANNELS.map((ch) => (
          <ChannelCard key={ch.title} channel={ch} />
        ))}
      </XStack>
    </YStack>
  )
}

function ChannelCard({ channel }: { channel: Channel }) {
  const { icon: Icon, title, body, href, cta } = channel
  // The Card IS the flex item — and the link, via render="a" (Stacks pass href/target
  // through on web). Keeps layout on one node; no non-flex Anchor wrapper.
  // `render`, not gui 7's `tag`: gui drops an unknown prop silently, so `tag` rendered
  // a <div> and every contact channel — mailto included — was a dead card.
  const link = href
    ? { render: 'a' as const, href, target: href.startsWith('mailto:') ? undefined : '_blank', rel: 'noopener noreferrer', cursor: 'pointer' as const, textDecorationLine: 'none' as const }
    : {}
  return (
    <Card
      {...link}
      p="$4"
      gap="$3"
      borderWidth={1}
      borderColor="$borderColor"
      bg="$color1"
      hoverStyle={href ? { borderColor: '$color8', bg: '$color2' } : undefined}
      // 3-up desktop, 2-up tablet, 1-up mobile — grow from a fixed basis.
      flexGrow={1}
      flexBasis={320}
      minW={260}
      $sm={{ flexBasis: '100%', minW: 0 }}
    >
      <Icon size={22} color="$color11" />
      <YStack gap="$1.5">
        <Text fontSize="$6" fontWeight="700">
          {title}
        </Text>
        <Text fontSize="$3" color="$color11" lineHeight="$2">
          {body}
        </Text>
        {cta ? (
          <Text fontSize="$3" color="$color11" mt="$1">
            {cta}
          </Text>
        ) : null}
      </YStack>
    </Card>
  )
}
