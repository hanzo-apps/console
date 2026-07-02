'use client'

/**
 * Content — surfaces the REAL, live Hanzo Content Studio (a Payload headless CMS,
 * deployed at cms.<brand> and confirmed live at cms.hanzo.ai/admin). There is no
 * per-org `/v1/cms` cloud surface yet, so this module does NOT fabricate content
 * rows or counts: it is an honest in-console home for the Content Studio — what it
 * is, what it manages, and a real primary action that opens the Studio (IAM-SSO).
 *
 * White-label: the Studio host is derived from the current brand host (console.<x>
 * → cms.<x>), so a Lux/Zoo/Pars console links to ITS OWN Studio, never Hanzo's.
 * Access is governed SERVER-SIDE by the Studio's own IAM login — this surface only
 * links to it, exactly like the codebase's other external-surface opens
 * (`window.open(url, '_blank', 'noopener')`), never an embedded credential.
 */
import { useMemo } from 'react'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { ArrowUpRight, FileText, Image as ImageIcon, Newspaper, Globe } from '@hanzogui/lucide-icons-2'

import { PageHeader } from '~/components/ui/PageHeader'
import { FadeIn } from '~/components/ui/FadeIn'

/** Derive the brand's Content Studio origin from the current host (white-label). */
function studioOrigin(): string {
  if (typeof window === 'undefined') return 'https://cms.hanzo.ai'
  const host = window.location.hostname
  // console.hanzo.ai / admin.hanzo.ai / cloud.hanzo.ai → cms.hanzo.ai
  const parts = host.split('.')
  if (parts.length >= 2) return `https://cms.${parts.slice(1).join('.')}`
  return 'https://cms.hanzo.ai'
}

const MANAGES: { icon: typeof FileText; label: string; body: string }[] = [
  { icon: FileText, label: 'Pages', body: 'Structured, versioned pages that render your marketing and product site.' },
  { icon: Newspaper, label: 'Posts', body: 'Blog and changelog entries with drafts, scheduling, and publish workflow.' },
  { icon: ImageIcon, label: 'Media', body: 'A managed media library — uploads, focal points, and responsive variants.' },
  { icon: Globe, label: 'Globals', body: 'Site-wide navigation, footer, and settings shared across every surface.' },
]

export function CmsModule() {
  const origin = useMemo(studioOrigin, [])
  const open = () => window.open(`${origin}/admin`, '_blank', 'noopener')

  return (
    <>
      <PageHeader
        title="Content"
        subtitle="Your Content Studio — a headless CMS for pages, posts, and media, with IAM single sign-on."
        actions={
          <Button size="$3" iconAfter={<ArrowUpRight size={15} />} onPress={open}>
            Open Content Studio
          </Button>
        }
      />
      <FadeIn>
        <YStack gap="$4" maxW={860}>
          <Card borderWidth={1} borderColor="$borderColor" p="$5" gap="$3">
            <Text fontSize="$6" fontWeight="800" color="$color12">
              Hanzo Content Studio
            </Text>
            <Text fontSize="$3" color="$color11">
              The Content Studio is a live, block-based headless CMS. Edit pages, posts, and media in a
              rich admin, then serve them to your site, docs, and apps over a versioned content API.
              Sign-in uses your Hanzo identity (IAM SSO) — no separate password.
            </Text>
            <XStack gap="$2" items="center" flexWrap="wrap">
              <Text fontSize="$2" color="$color10">Studio</Text>
              <Text fontSize="$2" color="$color11">{origin}/admin</Text>
            </XStack>
            <XStack>
              <Button size="$3" iconAfter={<ArrowUpRight size={15} />} onPress={open}>
                Open Content Studio
              </Button>
            </XStack>
          </Card>

          <XStack gap="$3" flexWrap="wrap">
            {MANAGES.map(({ icon: Icon, label, body }) => (
              <Card key={label} borderWidth={1} borderColor="$borderColor" p="$4" gap="$2" flex={1} minWidth={260}>
                <XStack gap="$2" items="center">
                  <Icon size={18} />
                  <Text fontSize="$4" fontWeight="700" color="$color12">{label}</Text>
                </XStack>
                <Text fontSize="$2" color="$color11">{body}</Text>
              </Card>
            ))}
          </XStack>
        </YStack>
      </FadeIn>
    </>
  )
}
