'use client'

/**
 * PitchHero — the NATIVE, dynamic, personalized product pitch + getting-started
 * panel. It replaces the old "forked from X" upstream note with something that SELLS
 * the product: a headline + value props (the why), above a getting-started checklist
 * (the how) that checks itself off against the user's REAL state and can launch a
 * spotlight tour of what's left.
 *
 * DYNAMIC + honest by construction:
 *  - every step's done-state comes from a real signal (has an API key, has opened the
 *    product) — never fabricated; unknown ⟹ not done;
 *  - the panel auto-hides once every visible step is done (or the user dismisses it),
 *    so it leads the page for a new user and gets out of a power user's way;
 *  - `when` predicates personalize which steps appear (e.g. "invite your team" only
 *    for an org admin);
 *  - the tour is generated from the INCOMPLETE steps and spotlights their on-screen
 *    rows — zero external scripts (works in the go:embed console, under any CSP).
 *
 * Accessible + reduced-motion-safe: entrance via the shared `FadeIn` (CSS keyframe,
 * honors prefers-reduced-motion); no count-up or auto-motion; every control labeled.
 * @hanzo/gui v5 shorthands only.
 */
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button, Card, Text, XStack, YStack } from '@hanzo/gui'
import {
  ArrowRight,
  Check,
  Code,
  Coins,
  Compass,
  Database,
  Gauge,
  Globe,
  Lock,
  Plug,
  Rocket,
  Search,
  Shield,
  Sparkles,
  X,
  Zap,
} from '@hanzogui/lucide-icons-2'

import { FadeIn } from '~/components/ui/FadeIn'
import { GuidedTour } from '~/components/tour/GuidedTour'
import { useGuideSignals } from '~/lib/guide/use-signals'
import { stepAnchorId } from '~/lib/guide/signals'
import { isGuideDismissed, dismissGuide } from '~/lib/guide/guard'
import {
  buildTourFromSteps,
  completion,
  incompleteCount,
  resolveSteps,
  resolveTour,
  type PitchIcon,
  type ProductGuide,
} from '~/lib/guide/spec'
import type { ProductIcon } from '~/lib/products/registry'

/** Pitch-point icon name → Lucide glyph (kept out of the pure data layer). */
const PITCH_ICON: Record<PitchIcon, ProductIcon> = {
  zap: Zap,
  gauge: Gauge,
  shield: Shield,
  sparkles: Sparkles,
  plug: Plug,
  code: Code,
  coins: Coins,
  globe: Globe,
  lock: Lock,
  rocket: Rocket,
  search: Search,
  database: Database,
}

const onAdminHost = (): boolean =>
  typeof window !== 'undefined' && window.location.hostname.startsWith('admin.')

/** The pitch + dynamic getting-started panel for one product guide. */
export function PitchHero({ guide }: { guide: ProductGuide }) {
  const router = useRouter()
  const { signals, ready } = useGuideSignals()
  const owner = signals.owner

  const [mounted, setMounted] = useState(false)
  const [dismissed, setDismissed] = useState(false)
  const [tourOpen, setTourOpen] = useState(false)

  useEffect(() => setMounted(true), [])
  useEffect(() => {
    if (owner) setDismissed(isGuideDismissed(owner, guide.id))
  }, [owner, guide.id])

  // Never block, never flash: wait for hydration + preferences, and stay off the
  // operator host (customer onboarding, not an operator surface).
  if (!mounted || !ready || onAdminHost()) return null

  const resolved = resolveSteps(guide, signals)
  // Auto-hide once there is nothing left to do (or the user dismissed it) — the panel
  // leads the page for a new user and disappears for one who is already set up.
  if (dismissed || incompleteCount(resolved) === 0) return null

  const { done, total, pct } = completion(resolved)
  const tourSteps = resolveTour(buildTourFromSteps(guide, resolved), signals)
  const { pitch } = guide

  const dismiss = () => {
    if (owner) dismissGuide(owner, guide.id)
    setDismissed(true)
  }

  return (
    <FadeIn style={{ width: '100%' }}>
      <Card
        testID="product-guide"
        p="$4"
        $md={{ p: '$5' }}
        gap="$4"
        borderWidth={1}
        borderColor="$borderColor"
        bg="$color1"
        overflow="hidden"
      >
        {/* Headline + subhead, with tour + dismiss controls */}
        <XStack justify="space-between" items="flex-start" gap="$3" flexWrap="wrap">
          <YStack flex={1} minW={260} gap="$2">
            <Text fontSize="$1" color="$color10" fontWeight="500">
              Get started
            </Text>
            {/* `hz-display` — the ONE way this app sets display leading (globals.css).
                It was `style={{ lineHeight: 1.12 }}`, which is a
                correct ratio in plain React but NOT under @hanzo/gui: react-native-web
                appends `px` to any numeric style value absent from its unitless list, and
                `lineHeight` is absent — so it compiled to `line-height: 1.12px`, a 1px box
                for a 30px headline whose descenders then fell into the subhead. */}
            <Text className="hz-display" fontSize="$8" $md={{ fontSize: '$9' }} fontWeight="900" color="$color12">
              {pitch.headline}
            </Text>
            <Text fontSize="$4" color="$color11" maxW={720}>
              {pitch.subhead}
            </Text>
          </YStack>
          <XStack gap="$2" items="center">
            {/* Neutral, not filled: the ONE filled action in this card is the
                checklist's ACTIVE step below — the thing to do next. A white "Take
                the tour" beside it made two buttons compete for the same emphasis,
                and the tour is the aside. */}
            {tourSteps.length ? (
              <Button size="$2" icon={<Compass size={14} />} onPress={() => setTourOpen(true)}>
                Take the tour
              </Button>
            ) : null}
            <Button size="$2" chromeless circular icon={<X size={16} />} onPress={dismiss} aria-label="Dismiss getting-started" />
          </XStack>
        </XStack>

        {/* Value props — the WHY */}
        {pitch.points.length ? (
          <XStack flexWrap="wrap" gap="$3">
            {pitch.points.map((p) => {
              const PIcon = p.icon ? PITCH_ICON[p.icon] : Sparkles
              return (
                <YStack key={p.title} flex={1} minW={200} gap="$1.5" p="$3" rounded="$4" bg="$color2" borderWidth={1} borderColor="$borderColor">
                  <XStack items="center" gap="$2">
                    <PIcon size={16} />
                    <Text fontSize="$4" fontWeight="800" color="$color12">
                      {p.title}
                    </Text>
                  </XStack>
                  <Text fontSize="$2" color="$color11">
                    {p.body}
                  </Text>
                </YStack>
              )
            })}
          </XStack>
        ) : null}

        {/* Getting-started checklist — the dynamic HOW */}
        <XStack items="center" justify="space-between" gap="$3" pt="$1">
          <Text fontSize="$5" fontWeight="800" color="$color12">
            Getting started
          </Text>
          <Text fontSize="$2" color="$color10" fontWeight="600">
            {done} of {total} done
          </Text>
        </XStack>

        {/* Progress meter (static — reduced-motion-safe) */}
        <YStack height={6} rounded="$10" bg="$color4" overflow="hidden" aria-hidden>
          <YStack height={6} rounded="$10" style={{ width: `${pct}%`, backgroundColor: '#2ea043' }} />
        </YStack>

        <YStack gap="$2.5">
          {resolved.map((r, i) => (
            <XStack
              key={r.step.id}
              data-tour={stepAnchorId(guide.id, r.step.id)}
              items="center"
              gap="$3"
              p="$3"
              rounded="$4"
              borderWidth={1}
              borderColor={r.active ? '$color8' : '$borderColor'}
              bg={r.active ? '$color2' : '$color1'}
            >
              <YStack
                width={26}
                height={26}
                rounded="$10"
                items="center"
                justify="center"
                {...(r.done ? { style: { backgroundColor: '#2ea043' } } : { bg: r.active ? '$color12' : '$color4' })}
              >
                {r.done ? (
                  <Check size={15} color="#fff" />
                ) : (
                  <Text fontSize="$2" fontWeight="800" color={r.active ? '$color1' : '$color11'}>
                    {i + 1}
                  </Text>
                )}
              </YStack>
              <YStack flex={1} gap="$0.5" minW={0}>
                <Text fontSize="$4" fontWeight="700" color="$color12" style={r.done ? { textDecorationLine: 'line-through' } : undefined}>
                  {r.step.title}
                </Text>
                <Text fontSize="$2" color="$color10">
                  {r.step.body}
                </Text>
              </YStack>
              {r.step.action ? (
                <Button
                  size="$2"
                  theme={r.active ? 'light' : undefined}
                  chromeless={!r.active}
                  iconAfter={<ArrowRight size={14} />}
                  onPress={() => router.push(r.step.action!.to)}
                >
                  {r.done ? 'Revisit' : r.step.action.label}
                </Button>
              ) : null}
            </XStack>
          ))}
        </YStack>

        <GuidedTour steps={tourSteps} open={tourOpen} onClose={() => setTourOpen(false)} onFinish={() => setTourOpen(false)} />
      </Card>
    </FadeIn>
  )
}
