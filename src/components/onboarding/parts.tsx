'use client'

/**
 * Onboarding shared UI — the wizard's reusable pieces (step shell, footer actions,
 * progress rail, selectable choice card). Kept small and monochrome (@hanzo/gui v5
 * shorthands, Geist), so every step reads as one system and only the STEP content
 * differs. No step reimplements navigation chrome.
 */
import type { ReactNode } from 'react'
import { Button, Card, Spinner, Text, XStack, YStack } from '@hanzo/gui'
import { ArrowLeft, ArrowRight, Check } from '@hanzogui/lucide-icons-2'

import { PrimaryButton } from '~/components/ui/PrimaryButton'
import { ONBOARDING_STEPS, type StepId, type StepStatus } from '~/lib/onboarding/steps'

/** Title + subtitle header + body for one step. */
/**
 * The content area's reserved height. Every step's body occupies at least this
 * much, so `actions` lands at the SAME y on every step and Continue never moves
 * under the pointer between steps — the whole reason actions is a slot on the
 * shell rather than the last child a step happens to render.
 *
 * A taller step still grows (the area is flex), so this reserves space without
 * capping it.
 */
const CONTENT_MIN_HEIGHT = 320

export function StepShell({
  title,
  subtitle,
  children,
  actions,
}: {
  title: string
  subtitle: string
  children: ReactNode
  /**
   * The step's StepActions. It is a SLOT, not a child, so the shell decides
   * where it sits — one placement for every step, decided in one place.
   */
  actions?: ReactNode
}) {
  return (
    <YStack gap="$4" flex={1} minW={0}>
      <YStack gap="$1.5">
        <Text testID="onboarding-step-title" fontSize="$8" fontWeight="800" color="$color12">
          {title}
        </Text>
        <Text fontSize="$4" color="$color11">
          {subtitle}
        </Text>
      </YStack>
      <YStack gap="$4" flex={1} minH={CONTENT_MIN_HEIGHT}>
        {children}
      </YStack>
      {actions}
    </YStack>
  )
}

/**
 * The consistent footer: Back (when not first) · a step-level Skip · the primary
 * Continue. Each step supplies its own continue label / disabled / busy state and
 * commits its own side-effect before advancing.
 */
export function StepActions({
  onBack,
  onSkip,
  skipLabel = 'Skip',
  onContinue,
  continueLabel = 'Continue',
  continueDisabled,
  busy,
}: {
  onBack?: () => void
  onSkip?: () => void
  skipLabel?: string
  onContinue: () => void
  continueLabel?: string
  continueDisabled?: boolean
  busy?: boolean
}) {
  return (
    <XStack testID="onboarding-actions" gap="$3" items="center" justify="space-between" flexWrap="wrap" pt="$2">
      <XStack>
        {onBack ? (
          <Button size="$3" chromeless disabled={busy} icon={<ArrowLeft size={16} />} onPress={onBack}>
            Back
          </Button>
        ) : (
          <YStack />
        )}
      </XStack>
      <XStack gap="$2" items="center">
        {onSkip ? (
          <Button size="$3" chromeless disabled={busy} onPress={onSkip}>
            {skipLabel}
          </Button>
        ) : null}
        <PrimaryButton
          size="$4"
          disabled={busy || continueDisabled}
          iconAfter={busy ? <Spinner color="$color1" /> : <ArrowRight size={16} />}
          onPress={onContinue}
        >
          {continueLabel}
        </PrimaryButton>
      </XStack>
    </XStack>
  )
}

/** The left progress rail — every step with a done / current / upcoming marker. */
export function ProgressRail({
  currentIndex,
  status,
}: {
  currentIndex: number
  status: Partial<Record<StepId, StepStatus>>
}) {
  return (
    <YStack gap="$1" width={230} $md={{ display: 'none' }}>
      {ONBOARDING_STEPS.map((s, i) => {
        const done = status[s.id] === 'done' || status[s.id] === 'skipped' || i < currentIndex
        const current = i === currentIndex
        return (
          <XStack key={s.id} gap="$3" items="center" px="$3" py="$2.5" rounded="$4" bg={current ? '$color3' : 'transparent'}>
            <YStack
              width={26}
              height={26}
              rounded="$10"
              items="center"
              justify="center"
              borderWidth={current ? 0 : 1}
              borderColor="$borderColor"
              bg={current ? '$color12' : done ? '$color5' : 'transparent'}
            >
              {done && !current ? (
                <Check size={14} color="var(--color11)" />
              ) : (
                <Text fontSize="$2" fontWeight="700" color={current ? '$color1' : '$color11'}>
                  {i + 1}
                </Text>
              )}
            </YStack>
            <YStack flex={1} minW={0}>
              <Text fontSize="$3" fontWeight={current ? '700' : '500'} color={current ? '$color12' : '$color11'}>
                {s.title}
              </Text>
              <Text fontSize="$1" color="$color10" numberOfLines={1}>
                {s.blurb}
              </Text>
            </YStack>
          </XStack>
        )
      })}
    </YStack>
  )
}

/** A selectable option card (AI-access options, first-action tiles). */
export function ChoiceCard({
  icon,
  title,
  description,
  selected,
  badge,
  onPress,
  children,
  disabled,
}: {
  icon: ReactNode
  title: string
  description: string
  selected?: boolean
  badge?: string
  onPress?: () => void
  children?: ReactNode
  disabled?: boolean
}) {
  return (
    <Card
      p="$4"
      gap="$3"
      borderWidth={1}
      borderColor={selected ? '$color12' : '$borderColor'}
      bg={selected ? '$color2' : '$color1'}
      opacity={disabled ? 0.6 : 1}
      cursor={onPress && !disabled ? 'pointer' : 'default'}
      hoverStyle={onPress && !disabled ? { borderColor: '$color10' } : undefined}
      onPress={disabled ? undefined : onPress}
    >
      <XStack gap="$3" items="flex-start" justify="space-between">
        <XStack gap="$3" items="center" flex={1} minW={0}>
          <YStack width={40} height={40} rounded="$4" items="center" justify="center" bg="$color3">
            {icon}
          </YStack>
          <YStack flex={1} minW={0} gap="$1">
            <XStack gap="$2" items="center" flexWrap="wrap">
              <Text fontSize="$5" fontWeight="700" color="$color12">
                {title}
              </Text>
              {badge ? (
                <Text fontSize="$1" fontWeight="700" px="$2" py="$0.5" rounded="$10" bg="$color12" color="$color1">
                  {badge}
                </Text>
              ) : null}
            </XStack>
            <Text fontSize="$3" color="$color11">
              {description}
            </Text>
          </YStack>
        </XStack>
        {selected ? (
          <YStack width={22} height={22} rounded="$10" items="center" justify="center" bg="$color12">
            <Check size={14} color="var(--color1)" />
          </YStack>
        ) : null}
      </XStack>
      {children}
    </Card>
  )
}

/** A small inline external link (Terms / Privacy), monochrome + underlined. */
export function InlineLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      style={{ color: 'var(--color12)', textDecoration: 'underline', fontWeight: 600 }}
    >
      {children}
    </a>
  )
}
