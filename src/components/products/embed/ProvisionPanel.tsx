'use client'

/**
 * ProvisionPanel — the honest "this app isn't provisioned for you yet" surface for
 * an embeddable product (ERP, or the Content Studio for a customer org). NOT a fake
 * product and NOT a dead link: it states what the app is, what it will manage, and
 * offers a REAL provisioning request (the same-origin `/waitlist` intake, which
 * records the request server-side and returns an honest 501 when the intake isn't
 * open — never a fabricated "deployed"). The moment a real instance is live, the
 * module embeds it instead (EmbeddedApp) — this panel is only the pre-provision state.
 *
 * DRY: both the ERP module (no instance anywhere yet) and the CMS module (a shared
 * per-brand Studio, so a CUSTOMER org has no instance of its own) render through
 * this one panel; they differ only in copy, features, and the intake slug.
 */
import type { ComponentType, ReactNode } from 'react'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import { ArrowUpRight } from '@hanzogui/lucide-icons-2'

import { PageHeader } from '~/components/ui/PageHeader'
import { FadeIn } from '~/components/ui/FadeIn'
import { WaitlistForm } from '~/components/products/WaitlistForm'

export type ProvisionFeature = {
  icon: ComponentType<{ size?: number }>
  label: string
  body: string
}

export function ProvisionPanel({
  title,
  subtitle,
  heroTitle,
  heroBody,
  features,
  intakeSlug,
  intakeLabel,
  cta,
  docsHref,
  sourceLabel,
  note,
}: {
  title: string
  subtitle?: string
  /** Hero card heading (e.g. "Hanzo ERP" / "Content Studio for your org"). */
  heroTitle: string
  /** Hero card body — what it is + the honest provisioning status. */
  heroBody: ReactNode
  /** The "what it manages" cards. */
  features: ProvisionFeature[]
  /** `/waitlist` intake slug (a real per-product provisioning-request list). */
  intakeSlug: string
  /** Human label for the intake copy (e.g. "ERP"). */
  intakeLabel: string
  /** Provision button label (e.g. "Request ERP"). */
  cta: string
  docsHref?: string
  /** Optional repo/source label shown in the footer (e.g. `hanzoai/erp`). */
  sourceLabel?: string
  note?: ReactNode
}) {
  const openDocs = () => {
    if (docsHref && typeof window !== 'undefined') window.open(docsHref, '_blank', 'noopener')
  }
  return (
    <>
      <PageHeader
        title={title}
        subtitle={subtitle}
        actions={
          docsHref ? (
            <Button size="$2" chromeless iconAfter={<ArrowUpRight size={15} />} onPress={openDocs}>
              Docs
            </Button>
          ) : undefined
        }
      />
      <FadeIn>
        <YStack gap="$4" maxW={860}>
          <Card borderWidth={1} borderColor="$borderColor" p="$5" gap="$3">
            <Text fontSize="$6" fontWeight="800" color="$color12">
              {heroTitle}
            </Text>
            <Text fontSize="$3" color="$color11">
              {heroBody}
            </Text>
            <YStack gap="$2" mt="$2">
              <Text fontSize="$2" fontWeight="700" color="$color11">
                Provision {intakeLabel} for your organization
              </Text>
              <WaitlistForm waitlist={intakeSlug} label={intakeLabel} cta={cta} busyCta="Requesting…" />
            </YStack>
          </Card>

          <XStack gap="$3" flexWrap="wrap">
            {features.map(({ icon: Icon, label, body }) => (
              <Card key={label} borderWidth={1} borderColor="$borderColor" p="$4" gap="$2" flex={1} minWidth={240}>
                <XStack gap="$2" items="center">
                  <Icon size={18} />
                  <Text fontSize="$4" fontWeight="700" color="$color12">
                    {label}
                  </Text>
                </XStack>
                <Text fontSize="$2" color="$color11">
                  {body}
                </Text>
              </Card>
            ))}
          </XStack>

          {note ? (
            <Text fontSize="$2" color="$color10">
              {note}
            </Text>
          ) : null}
          {sourceLabel ? (
            <Text fontSize="$2" color="$color9">
              {sourceLabel}
            </Text>
          ) : null}
        </YStack>
      </FadeIn>
    </>
  )
}
